import { type Job } from "bullmq";
import { readFile, writeFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import * as dbq from "@repo/db";
import { transcribeWithGemini, type Segment } from "../lib/gemini";
import { convertToMp3, sliceToMp3, formatTimestamp } from "../lib/ffmpeg";
import { uploadToS3 } from "../lib/s3";
import { generateDatasetCsv } from "../lib/csv";
import { logger } from "../logger";

export interface AudioJobData {
  captureId: string;
  mixedUrl: string;
  callerAUrl: string;
  callerBUrl: string;
}

export async function processAudio(job: Job<AudioJobData>): Promise<void> {
  const { captureId, mixedUrl, callerAUrl, callerBUrl } = job.data;
  const log = logger.child({ captureId, jobId: job.id });

  log.info("Starting audio processing pipeline");

  const tmpDir = await mkdtemp(path.join(tmpdir(), `audio-${captureId}-`));

  try {
    // ── Step 1: Download all 3 recordings ──────────────────────────
    await job.updateProgress(5);
    log.info("Step 1: Downloading recordings");

    const [mixedBuf, callerABuf, callerBBuf] = await Promise.all([
      downloadFile(mixedUrl),
      downloadFile(callerAUrl),
      downloadFile(callerBUrl),
    ]);

    const mixedRaw = path.join(tmpDir, "mixed.mp4");
    const callerARaw = path.join(tmpDir, "caller_a.mp4");
    const callerBRaw = path.join(tmpDir, "caller_b.mp4");

    await Promise.all([
      writeFile(mixedRaw, mixedBuf),
      writeFile(callerARaw, callerABuf),
      writeFile(callerBRaw, callerBBuf),
    ]);

    // ── Step 2: Convert to MP3 ─────────────────────────────────────
    await job.updateProgress(15);
    log.info("Step 2: Converting to MP3");

    const mixedMp3 = path.join(tmpDir, "mixed.mp3");
    const callerAMp3 = path.join(tmpDir, "participant-a.mp3");
    const callerBMp3 = path.join(tmpDir, "participant-b.mp3");

    await Promise.all([
      convertToMp3(mixedRaw, mixedMp3),
      convertToMp3(callerARaw, callerAMp3),
      convertToMp3(callerBRaw, callerBMp3),
    ]);

    // ── Step 3: Upload full tracks to structured S3 paths ──────────
    await job.updateProgress(25);
    log.info("Step 3: Uploading full tracks");

    const [mixedUrl2, trackAUrl, trackBUrl] = await Promise.all([
      uploadToS3(`captures/${captureId}/mixed.mp3`, await readFile(mixedMp3), "audio/mpeg"),
      uploadToS3(`captures/${captureId}/participant-a/full.mp3`, await readFile(callerAMp3), "audio/mpeg"),
      uploadToS3(`captures/${captureId}/participant-b/full.mp3`, await readFile(callerBMp3), "audio/mpeg"),
    ]);

    // ── Step 4: Transcribe with Gemini ─────────────────────────────
    await job.updateProgress(35);
    log.info("Step 4: Transcribing with Gemini");

    const [resultA, resultB] = await Promise.all([
      transcribeWithGemini(await readFile(callerAMp3), "audio/mp3"),
      transcribeWithGemini(await readFile(callerBMp3), "audio/mp3"),
    ]);

    log.info({ segmentsA: resultA.segments.length, segmentsB: resultB.segments.length }, "Transcription complete");

    // ── Step 5: Slice utterances to MP3 clips (parallel batches) ───
    await job.updateProgress(50);
    log.info("Step 5: Slicing utterances");

    const clipUrlsA = await sliceAndUpload(callerAMp3, resultA.segments, captureId, "participant-a", tmpDir);
    await job.updateProgress(65);
    const clipUrlsB = await sliceAndUpload(callerBMp3, resultB.segments, captureId, "participant-b", tmpDir);

    // ── Step 6: Generate CSV for SOTA Labs ─────────────────────────
    await job.updateProgress(80);
    log.info("Step 6: Generating dataset CSV");

    const csv = generateDatasetCsv(
      captureId,
      { segments: resultA.segments, clipUrls: clipUrlsA, trackUrl: trackAUrl },
      { segments: resultB.segments, clipUrls: clipUrlsB, trackUrl: trackBUrl },
    );

    const csvUrl = await uploadToS3(`captures/${captureId}/dataset.csv`, Buffer.from(csv, "utf-8"), "text/csv");

    // Also upload full transcript JSON
    const transcript = {
      captureId,
      participantA: resultA.segments.map((s, i) => ({ ...s, clipUrl: clipUrlsA[i] })),
      participantB: resultB.segments.map((s, i) => ({ ...s, clipUrl: clipUrlsB[i] })),
    };
    await uploadToS3(
      `captures/${captureId}/transcript.json`,
      Buffer.from(JSON.stringify(transcript, null, 2), "utf-8"),
      "application/json",
    );

    // ── Step 7: Update database ────────────────────────────────────
    await job.updateProgress(90);
    log.info("Step 7: Saving to database");

    await dbq.updateCapture(captureId, {
      status: "completed",
      recordingUrl: mixedUrl2,
      recordingUrlA: trackAUrl,
      recordingUrlB: trackBUrl,
      transcriptA: JSON.stringify(resultA.segments.map((s, i) => ({
        start: s.startSeconds,
        end: s.endSeconds,
        text: s.content,
        language: s.language,
        emotion: s.emotion,
        audioUrl: clipUrlsA[i],
      }))),
      transcriptB: JSON.stringify(resultB.segments.map((s, i) => ({
        start: s.startSeconds,
        end: s.endSeconds,
        text: s.content,
        language: s.language,
        emotion: s.emotion,
        audioUrl: clipUrlsB[i],
      }))),
    });

    await job.updateProgress(100);
    log.info({ csvUrl, segmentsA: resultA.segments.length, segmentsB: resultB.segments.length }, "Pipeline complete");
  } finally {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  }
}

/** Download a file from URL and return the buffer */
async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Slice all segments from a track and upload to S3, returns array of public URLs */
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

        await sliceToMp3(audioPath, clipPath, seg.startSeconds, seg.endSeconds);
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
