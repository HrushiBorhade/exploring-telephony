import "dotenv/config";
// Telemetry must be initialized before any other imports
import { initTelemetry, shutdownTelemetry } from "./telemetry";
initTelemetry();

import express from "express";
import { logger } from "./logger";
import { env } from "./env";
import * as dbq from "@repo/db";
import { setupMiddleware } from "./middleware/setup";

// Routes
import captureRoutes from "./routes/captures";
import webhookRoutes from "./routes/webhooks";
import recordingRoutes from "./routes/recordings";
import healthRoutes from "./routes/health";

const { PORT } = env;

// Catch unhandled promise rejections
process.on("unhandledRejection", (reason: any) => {
  logger.error("[UNHANDLED]", reason?.message ?? reason);
});

// ════════════════════════════════════════════════════════════════════
// Express app
// ════════════════════════════════════════════════════════════════════

const app = express();
setupMiddleware(app);

// Mount routes
app.use(captureRoutes);
app.use(webhookRoutes);
app.use(recordingRoutes);
app.use(healthRoutes);

// ════════════════════════════════════════════════════════════════════
// Start + Graceful Shutdown
// ════════════════════════════════════════════════════════════════════

const server = app.listen(Number(PORT), async () => {
  logger.info({ port: PORT }, "Voice Capture Platform started");

  // Reconcile captures orphaned by a previous crash/restart
  try {
    const stale = await dbq.findStaleCaptures();
    for (const c of stale) {
      await dbq.updateCapture(c.id, { status: "ended", endedAt: new Date(), durationSeconds: 0 });
      logger.warn({ captureId: c.id, prevStatus: c.status }, "[STARTUP] Marked orphaned capture as ended");
    }
    if (stale.length > 0) logger.info(`[STARTUP] Reconciled ${stale.length} orphaned capture(s)`);
  } catch (err: any) {
    logger.error("[STARTUP] Reconciliation failed:", err.message);
  }
});

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down gracefully...");
  server.close(async () => {
    await shutdownTelemetry();
    logger.info("HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 30_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
