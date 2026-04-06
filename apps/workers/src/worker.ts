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

audioWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, captureId: job?.data.captureId, error: err.message }, "Job failed");
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
