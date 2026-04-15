import "dotenv/config";

import express from "express";
import { logger } from "./logger";
import { env } from "./env";
import * as dbq from "@repo/db";
import { setupMiddleware } from "./middleware/setup";
import { globalErrorHandler } from "./middleware/error-handler";

// Routes
import captureRoutes from "./routes/captures";
import webhookRoutes from "./routes/webhooks";
import healthRoutes from "./routes/health";
import profileRoutes from "./routes/profile";
import themeRoutes from "./routes/themes";

const { PORT } = env;

// Catch unhandled promise rejections
process.on("unhandledRejection", (reason: any) => {
  logger.error({ err: reason?.message, stack: reason?.stack }, "Unhandled promise rejection");
});

// ════════════════════════════════════════════════════════════════════
// Express app
// ════════════════════════════════════════════════════════════════════

const app = express();

// Trust proxy (required before any middleware)
app.set("trust proxy", 1);

// Better Auth — mounted BEFORE express.json() (handles its own body parsing).
// CORS is handled manually here since setupMiddleware runs after.
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth";

const ALLOWED_ORIGINS = env.NODE_ENV === "production"
  ? [env.FRONTEND_URL].filter((v): v is string => !!v)
  : ["http://localhost:3000", "http://localhost:8080", "http://localhost:3002"];

app.all("/api/auth/*splat", (req, res, next) => {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  toNodeHandler(auth)(req, res);
});

setupMiddleware(app);

// Mount routes
app.use(captureRoutes);
app.use(webhookRoutes);
app.use(healthRoutes);
app.use(profileRoutes);
app.use(themeRoutes);

// 404 catch-all — return JSON instead of Express default HTML
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler — must be AFTER all routes
app.use(globalErrorHandler);

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

