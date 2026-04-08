import "dotenv/config";

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
import profileRoutes from "./routes/profile";

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
app.use(profileRoutes);

// 404 catch-all — return JSON instead of Express default HTML
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ════════════════════════════════════════════════════════════════════
// Start + Graceful Shutdown
// ════════════════════════════════════════════════════════════════════

async function start() {
  // Run pending DB migrations BEFORE accepting traffic.
  // Runs inside VPC (ECS) where RDS is reachable. Advisory lock prevents
  // concurrent migration runs during rolling deploys (multiple ECS tasks).
  // If migration fails in prod, container exits → ECS circuit breaker rolls back.
  try {
    const { runMigrations } = await import("@repo/db/migrate");
    await runMigrations();
  } catch (err: any) {
    logger.error({ error: err.message }, "[STARTUP] Migration failed");
    if (process.env.NODE_ENV === "production") {
      logger.fatal("Exiting — migration must succeed before serving traffic");
      process.exit(1);
    }
  }

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
}

start();
