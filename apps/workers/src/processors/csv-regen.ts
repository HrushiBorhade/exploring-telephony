import { type Job } from "bullmq";
import * as dbq from "@repo/db";
import { generateDatasetCsv } from "../lib/csv";
import { uploadToS3 } from "../lib/s3";
import { logger } from "../logger";
import type { Segment } from "../lib/gemini";

export interface CsvRegenJobData {
  captureId: string;
}

/**
 * Lightweight CSV regeneration — no transcription, no audio processing.
 * Reads edited transcripts from DB, regenerates CSV, uploads to S3.
 * Typically completes in ~1-2 seconds.
 */
export async function processCsvRegen(job: Job<CsvRegenJobData>): Promise<void> {
  const { captureId } = job.data;
  const log = logger.child({ captureId, jobId: job.id });

  log.info("Starting CSV regeneration");

  const capture = await dbq.getCapture(captureId);
  if (!capture) throw new Error(`Capture ${captureId} not found`);

  // Parse transcripts — they contain { start, end, text, language, emotion, audioUrl }
  const parseTranscript = (raw: string | null) => {
    if (!raw) return { segments: [] as Segment[], clipUrls: [] as string[] };
    const arr = JSON.parse(raw) as Array<{
      start: number; end: number; text: string;
      language: string; emotion: string; audioUrl?: string;
    }>;
    return {
      segments: arr.map((u) => ({
        startSeconds: u.start,
        endSeconds: u.end,
        content: u.text,
        language: u.language,
        emotion: u.emotion as Segment["emotion"],
      })),
      clipUrls: arr.map((u) => u.audioUrl || ""),
    };
  };

  const dataA = parseTranscript(capture.transcriptA ?? null);
  const dataB = parseTranscript(capture.transcriptB ?? null);

  const csv = generateDatasetCsv(
    captureId,
    { segments: dataA.segments, clipUrls: dataA.clipUrls, trackUrl: capture.recordingUrlA || "" },
    { segments: dataB.segments, clipUrls: dataB.clipUrls, trackUrl: capture.recordingUrlB || "" },
  );

  const csvUrl = await uploadToS3(
    `captures/${captureId}/dataset.csv`,
    Buffer.from(csv, "utf-8"),
    "text/csv",
  );

  await dbq.updateCapture(captureId, { datasetCsvUrl: csvUrl });

  log.info({ csvUrl }, "CSV regeneration complete");
}
