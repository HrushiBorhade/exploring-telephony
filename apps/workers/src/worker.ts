import "dotenv/config";

import { Worker } from "bullmq";
import { redisConnection } from "@repo/queues";
import { notifySlackError } from "@repo/shared";
import { processAudio, type AudioJobData } from "./processors/audio";
import { processCsvRegen, type CsvRegenJobData } from "./processors/csv-regen";
import { logger } from "./logger";
import { jobDuration, jobsTotal, startMetricsServer } from "./metrics";

const audioWorker = new Worker<AudioJobData>("audio-processing", processAudio, {
  connection: redisConnection,
  concurrency: 3,
  limiter: {
    max: 10,
    duration: 60_000,
  },
  lockDuration: 300_000,       // 5 min lock — if job doesn't report progress, considered stalled
  stalledInterval: 60_000,     // Check for stalled jobs every 60s
  maxStalledCount: 1,          // After 1 stall, move to failed
});

audioWorker.on("completed", (job) => {
  logger.info({ jobId: job.id, captureId: job.data.captureId }, "Job completed");
  const durationSec = (Date.now() - job.timestamp) / 1000;
  jobDuration.observe({ queue: "audio", status: "completed" }, durationSec);
  jobsTotal.inc({ queue: "audio", status: "completed" });
});

audioWorker.on("failed", async (job, err) => {
  const captureId = job?.data.captureId;
  const attemptsLeft = job ? job.opts.attempts! - job.attemptsMade : 0;
  logger.error({ jobId: job?.id, captureId, error: err.message, attemptsLeft }, "Job failed");
  if (job) {
    const durationSec = (Date.now() - job.timestamp) / 1000;
    jobDuration.observe({ queue: "audio", status: "failed" }, durationSec);
  }
  jobsTotal.inc({ queue: "audio", status: "failed" });

  // All retries exhausted — mark capture as failed
  if (captureId && attemptsLeft <= 0) {
    notifySlackError({
      type: "job-failure",
      error: err.message,
      context: { captureId, jobId: job?.id },
    }).catch((e) => logger.error({ err: e }, "Slack error notification failed"));

    try {
      const dbq = await import("@repo/db");
      await dbq.updateCapture(captureId, { status: "failed" });
      await dbq.releaseThemeSample(captureId).catch(() => {});
      logger.info({ captureId }, "Capture marked as failed, theme sample released (all retries exhausted)");
    } catch (dbErr: any) {
      logger.error({ captureId, error: dbErr.message }, "Failed to update capture status to failed");
    }
  }
});

audioWorker.on("error", (err) => {
  logger.error({ error: err.message }, "Worker error");
});

// CSV regeneration worker (lightweight — no transcription, just CSV rebuild)
const csvWorker = new Worker<CsvRegenJobData>("csv-regeneration", processCsvRegen, {
  connection: redisConnection,
  concurrency: 5,
});

csvWorker.on("completed", (job) => {
  logger.info({ jobId: job.id, captureId: job.data.captureId }, "CSV regeneration completed");
  const durationSec = (Date.now() - job.timestamp) / 1000;
  jobDuration.observe({ queue: "csv", status: "completed" }, durationSec);
  jobsTotal.inc({ queue: "csv", status: "completed" });
});

csvWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, captureId: job?.data.captureId, error: err.message }, "CSV regeneration failed");
  if (job) {
    const durationSec = (Date.now() - job.timestamp) / 1000;
    jobDuration.observe({ queue: "csv", status: "failed" }, durationSec);
  }
  jobsTotal.inc({ queue: "csv", status: "failed" });
});

logger.info("Workers started (audio + csv-regen), waiting for jobs...");

// Start Prometheus metrics HTTP server for scraping
startMetricsServer();

// Graceful shutdown
function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down workers...");
  Promise.all([audioWorker.close(), csvWorker.close()]).then(() => {
    logger.info("Workers stopped");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 30_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
