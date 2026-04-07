import "dotenv/config";

import { Worker } from "bullmq";
import { redisConnection } from "@repo/queues";
import { processAudio, type AudioJobData } from "./processors/audio";
import { logger } from "./logger";

const audioWorker = new Worker<AudioJobData>("audio-processing", processAudio, {
  connection: redisConnection,
  concurrency: 3,
  limiter: {
    max: 10,
    duration: 60_000,
  },
});

audioWorker.on("completed", (job) => {
  logger.info({ jobId: job.id, captureId: job.data.captureId }, "Job completed");
});

audioWorker.on("failed", async (job, err) => {
  const captureId = job?.data.captureId;
  const attemptsLeft = job ? job.opts.attempts! - job.attemptsMade : 0;
  logger.error({ jobId: job?.id, captureId, error: err.message, attemptsLeft }, "Job failed");

  // All retries exhausted — mark capture as failed
  if (captureId && attemptsLeft <= 0) {
    try {
      const dbq = await import("@repo/db");
      await dbq.updateCapture(captureId, { status: "failed" });
      logger.info({ captureId }, "Capture marked as failed (all retries exhausted)");
    } catch (dbErr: any) {
      logger.error({ captureId, error: dbErr.message }, "Failed to update capture status to failed");
    }
  }
});

audioWorker.on("error", (err) => {
  logger.error({ error: err.message }, "Worker error");
});

logger.info("Audio worker started, waiting for jobs...");

// Graceful shutdown
function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down worker...");
  audioWorker.close().then(() => {
    logger.info("Worker stopped");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 30_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
