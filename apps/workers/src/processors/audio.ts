import { type Job } from "bullmq";
import { readFile, writeFile, mkdtemp, rm, rename } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import * as dbq from "@repo/db";
import { transcribeWithDeepgram } from "../lib/deepgram";
import { type Segment } from "../lib/gemini";
import { convertToMp3, sliceMp3, formatTimestamp, getDuration, trimStart } from "../lib/ffmpeg";
import { enhanceUtterances } from "../lib/gemini-enhance";
import { uploadToS3, downloadFromS3, deleteS3Prefix } from "../lib/s3";
import { generateDatasetCsv } from "../lib/csv";
import { moderateTranscript } from "../lib/moderation";
import { logger } from "../logger";
import { extractTraceContext } from "@repo/shared";

export interface AudioJobData {
  captureId: string;
  mixedUrl: string;
  callerAUrl: string;
  callerBUrl: string;
  _trace?: Record<string, string>;
}

export async function processAudio(job: Job<AudioJobData>): Promise<void> {
  return extractTraceContext(job.data._trace, () => _processAudio(job));
}

async function _processAudio(job: Job<AudioJobData>): Promise<void> {
  const { captureId, mixedUrl, callerAUrl, callerBUrl } = job.data;
  const log = logger.child({ captureId, jobId: job.id });

  log.info("Starting audio processing pipeline");

  const stepStart = () => Date.now();
  const stepLog = (step: string, start: number) => {
    log.info({ step, durationMs: Date.now() - start }, `Step completed: ${step}`);
  };

  const tmpDir = await mkdtemp(path.join(tmpdir(), `audio-${captureId}-`));

  try {
    // ── Step 1: Download recordings from S3 ───────────────────────
    const t1 = stepStart();
    await job.updateProgress(5);
    log.info("Step 1: Downloading recordings");

    const [mixedBuf, callerABuf, callerBBuf] = await Promise.all([
      downloadFromS3(mixedUrl),
      downloadFromS3(callerAUrl),
      downloadFromS3(callerBUrl),
    ]);

    const mixedRaw = path.join(tmpDir, "mixed.mp4");
    const callerARaw = path.join(tmpDir, "caller_a.mp4");
    const callerBRaw = path.join(tmpDir, "caller_b.mp4");

    await Promise.all([
      writeFile(mixedRaw, mixedBuf),
      writeFile(callerARaw, callerABuf),
      writeFile(callerBRaw, callerBBuf),
    ]);
    stepLog("download", t1);

    // ── Step 2: Convert to MP3 16kHz mono ─────────────────────────
    const t2 = stepStart();
    await job.updateProgress(10);
    log.info("Step 2: Converting to MP3");

    const mixedMp3 = path.join(tmpDir, "mixed.mp3");
    const callerAMp3 = path.join(tmpDir, "participant-a.mp3");
    const callerBMp3 = path.join(tmpDir, "participant-b.mp3");

    await Promise.all([
      convertToMp3(mixedRaw, mixedMp3),
      convertToMp3(callerARaw, callerAMp3),
      convertToMp3(callerBRaw, callerBMp3),
    ]);
    stepLog("convert", t2);

    // ── Step 3: Align tracks (trim longer starts) ─────────────────
    const t3 = stepStart();
    const [durMixed, durA, durB] = await Promise.all([
      getDuration(mixedMp3),
      getDuration(callerAMp3),
      getDuration(callerBMp3),
    ]);

    const minDuration = Math.min(durMixed, durA, durB);
    log.info({ durMixed, durA, durB, minDuration }, "Track durations before alignment");

    const trimIfNeeded = async (file: string, dur: number, label: string) => {
      const excess = dur - minDuration;
      if (excess > 0.1) {
        const trimmed = file.replace(".mp3", "-aligned.mp3");
        await trimStart(file, trimmed, excess);
        await rename(trimmed, file);
        log.info({ label, trimmedSec: excess.toFixed(2) }, "Track aligned");
      }
    };

    await Promise.all([
      trimIfNeeded(mixedMp3, durMixed, "mixed"),
      trimIfNeeded(callerAMp3, durA, "caller_a"),
      trimIfNeeded(callerBMp3, durB, "caller_b"),
    ]);

    const [alignedDurMixed, alignedDurA, alignedDurB] = await Promise.all([
      getDuration(mixedMp3),
      getDuration(callerAMp3),
      getDuration(callerBMp3),
    ]);
    log.info({ alignedDurA, alignedDurB }, "Post-alignment durations");
    stepLog("align", t3);

    // ── Step 4: Upload full tracks to S3 ──────────────────────────
    const t4 = stepStart();
    await job.updateProgress(20);
    log.info("Step 4: Uploading full tracks");

    const [mixedUrl2, trackAUrl, trackBUrl] = await Promise.all([
      uploadToS3(`captures/${captureId}/mixed.mp3`, await readFile(mixedMp3), "audio/mpeg"),
      uploadToS3(`captures/${captureId}/participant-a/full.mp3`, await readFile(callerAMp3), "audio/mpeg"),
      uploadToS3(`captures/${captureId}/participant-b/full.mp3`, await readFile(callerBMp3), "audio/mpeg"),
    ]);
    stepLog("upload-tracks", t4);

    // ── Step 5: Transcribe with Deepgram (frame-accurate timestamps) ──
    const t5 = stepStart();
    await job.updateProgress(30);
    log.info("Step 5: Transcribing with Deepgram nova-3");

    const [resultA, resultB] = await Promise.all([
      transcribeWithDeepgram(await readFile(callerAMp3), "audio/mp3"),
      transcribeWithDeepgram(await readFile(callerBMp3), "audio/mp3"),
    ]);

    // Validate: filter segments < 0.1s, clamp to track duration
    const validateSegments = (segments: Segment[], dur: number) => {
      return segments
        .filter((s) => s.startSeconds >= 0 && s.startSeconds < dur && (s.endSeconds - s.startSeconds) >= 0.1)
        .map((s) => ({ ...s, endSeconds: Math.min(s.endSeconds, dur) }));
    };

    resultA.segments = validateSegments(resultA.segments, alignedDurA);
    resultB.segments = validateSegments(resultB.segments, alignedDurB);

    log.info({ segmentsA: resultA.segments.length, segmentsB: resultB.segments.length }, "Transcription complete");
    stepLog("transcribe", t5);

    // ── Step 6: Clip utterances with ffmpeg -c copy (no re-encoding) ──
    const t6 = stepStart();
    await job.updateProgress(50);
    log.info("Step 6: Slicing clips");

    await Promise.all([
      deleteS3Prefix(`captures/${captureId}/participant-a/clips/`),
      deleteS3Prefix(`captures/${captureId}/participant-b/clips/`),
    ]);

    const clipUrlsA = await sliceAndUpload(callerAMp3, resultA.segments, captureId, "participant-a", tmpDir);
    await job.updateProgress(65);
    const clipUrlsB = await sliceAndUpload(callerBMp3, resultB.segments, captureId, "participant-b", tmpDir);
    stepLog("clip", t6);

    // ── Step 7: Enhance with Gemini (better text, emotion, language) ──
    const t7 = stepStart();
    await job.updateProgress(70);
    log.info("Step 7: Enhancing utterances with Gemini");

    // Read clip files for Gemini enhancement
    const buildClipInputs = async (segments: Segment[], mp3Path: string) => {
      return Promise.all(segments.map(async (seg) => {
        const clipPath = path.join(tmpDir, `enhance-${seg.startSeconds.toFixed(2)}.mp3`);
        await sliceMp3(mp3Path, clipPath, seg.startSeconds, seg.endSeconds);
        const buffer = await readFile(clipPath);
        return { buffer, mimeType: "audio/mp3", fallbackText: seg.content, fallbackLanguage: seg.language };
      }));
    };

    const [clipsA, clipsB] = await Promise.all([
      buildClipInputs(resultA.segments, callerAMp3),
      buildClipInputs(resultB.segments, callerBMp3),
    ]);

    const [enhancedA, enhancedB] = await Promise.all([
      enhanceUtterances(clipsA),
      enhanceUtterances(clipsB),
    ]);

    // Merge: keep Deepgram timestamps, use Gemini text/emotion/language
    for (let i = 0; i < resultA.segments.length; i++) {
      resultA.segments[i].content = enhancedA[i].text;
      resultA.segments[i].emotion = enhancedA[i].emotion;
      resultA.segments[i].language = enhancedA[i].language;
    }
    for (let i = 0; i < resultB.segments.length; i++) {
      resultB.segments[i].content = enhancedB[i].text;
      resultB.segments[i].emotion = enhancedB[i].emotion;
      resultB.segments[i].language = enhancedB[i].language;
    }

    log.info({
      enhancedA: enhancedA.filter(e => e.enhanced).length,
      enhancedB: enhancedB.filter(e => e.enhanced).length,
      totalA: enhancedA.length,
      totalB: enhancedB.length,
    }, "Enhancement complete");
    stepLog("enhance", t7);

    // ── Step 8: Generate CSV ──────────────────────────────────────
    const t8 = stepStart();
    await job.updateProgress(80);
    log.info("Step 8: Generating CSV");

    const csv = generateDatasetCsv(
      captureId,
      { segments: resultA.segments, clipUrls: clipUrlsA, trackUrl: trackAUrl },
      { segments: resultB.segments, clipUrls: clipUrlsB, trackUrl: trackBUrl },
    );

    const csvUrl = await uploadToS3(`captures/${captureId}/dataset.csv`, Buffer.from(csv, "utf-8"), "text/csv");

    await uploadToS3(
      `captures/${captureId}/transcript.json`,
      Buffer.from(JSON.stringify({
        captureId,
        participantA: resultA.segments.map((s, i) => ({ ...s, clipUrl: clipUrlsA[i] })),
        participantB: resultB.segments.map((s, i) => ({ ...s, clipUrl: clipUrlsB[i] })),
      }, null, 2), "utf-8"),
      "application/json",
    );
    stepLog("csv", t8);

    // ── Step 9: Build utterances + moderation ─────────────────────
    const t9 = stepStart();
    await job.updateProgress(85);
    log.info("Step 9: Moderation scan");

    const utterancesA = resultA.segments.map((s, i) => ({
      start: s.startSeconds, end: s.endSeconds, text: s.content,
      language: s.language, emotion: s.emotion, audioUrl: clipUrlsA[i],
    }));
    const utterancesB = resultB.segments.map((s, i) => ({
      start: s.startSeconds, end: s.endSeconds, text: s.content,
      language: s.language, emotion: s.emotion, audioUrl: clipUrlsB[i],
    }));

    const moderated = await moderateTranscript(utterancesA, utterancesB);
    stepLog("moderation", t9);

    // ── Step 10: Save to database ─────────────────────────────────
    const t10 = stepStart();
    await job.updateProgress(95);
    log.info("Step 10: Saving to database");

    await dbq.updateCapture(captureId, {
      status: "completed",
      verified: false,
      durationSeconds: Math.round(alignedDurMixed),
      recordingUrl: mixedUrl2,
      recordingUrlA: trackAUrl,
      recordingUrlB: trackBUrl,
      datasetCsvUrl: csvUrl,
      transcriptA: JSON.stringify(moderated.utterancesA),
      transcriptB: JSON.stringify(moderated.utterancesB),
    });

    stepLog("save-db", t10);

    await job.updateProgress(100);
    log.info({ csvUrl, segmentsA: resultA.segments.length, segmentsB: resultB.segments.length }, "Pipeline complete");
  } finally {
    await rm(tmpDir, { recursive: true }).catch((e) => log.debug({ error: e.message }, "Temp cleanup failed"));
  }
}

/** Slice segments from an MP3 track using -c copy and upload to S3 */
async function sliceAndUpload(
  audioPath: string,
  segments: Segment[],
  captureId: string,
  participant: string,
  tmpDir: string,
  batchSize = 10,
): Promise<string[]> {
  const urls: string[] = new Array(segments.length).fill("");

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (seg, j) => {
        const idx = i + j;
        const ts = `${formatTimestamp(seg.startSeconds)}-${formatTimestamp(seg.endSeconds)}`;
        const filename = `${String(idx).padStart(3, "0")}-${ts}.mp3`;
        const clipPath = path.join(tmpDir, `${participant}-${filename}`);
        const s3Key = `captures/${captureId}/${participant}/clips/${filename}`;

        await sliceMp3(audioPath, clipPath, seg.startSeconds, seg.endSeconds);
        const clipData = await readFile(clipPath);
        const url = await uploadToS3(s3Key, clipData, "audio/mpeg");
        return { idx, url };
      }),
    );

    for (const r of results) {
      urls[r.idx] = r.url;
    }
  }

  return urls;
}
