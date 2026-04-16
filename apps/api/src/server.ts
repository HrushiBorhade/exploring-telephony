import "dotenv/config";

import express from "express";
import { logger } from "./logger";
import { env } from "./env";
import * as dbq from "@repo/db";
import { setupMiddleware } from "./middleware/setup";
import { roomService, egressClient } from "./lib/livekit";
import { globalErrorHandler } from "./middleware/error-handler";
import { notifySlackError } from "@repo/shared";
import { activeCaptures } from "./services/state";
import { captureActiveGauge } from "./metrics";

const MAX_CALL_DURATION_MS = 30 * 60 * 1000; // 30 minutes

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

  let durationCheckInterval: ReturnType<typeof setInterval> | null = null;

  const server = app.listen(Number(PORT), async () => {
    logger.info({ port: PORT }, "Voice Capture Platform started");

    // Reconcile captures orphaned by a previous crash/restart.
    // CRITICAL: Check LiveKit before marking as ended — during rolling deploys,
    // captures may be legitimately active in LiveKit rooms. Only mark as orphaned
    // if the LiveKit room no longer exists or has no participants.
    try {
      const stale = await dbq.findStaleCaptures();
      let reconciled = 0;
      let skipped = 0;
      for (const c of stale) {
        const roomName = c.roomName || `capture-${c.id}`;
        let roomAlive = false;
        try {
          const rooms = await roomService.listRooms([roomName]);
          if (rooms.length > 0 && rooms[0].numParticipants > 0) {
            roomAlive = true;
          }
        } catch {
          // LiveKit unreachable — err on the side of caution, don't kill the capture
          roomAlive = true;
        }

        if (roomAlive) {
          skipped++;
          logger.info({ captureId: c.id, roomName, prevStatus: c.status }, "[STARTUP] Capture still active in LiveKit — skipping reconciliation");
        } else {
          reconciled++;
          await dbq.updateCapture(c.id, { status: "ended", endedAt: new Date(), durationSeconds: 0 });
          logger.warn({ captureId: c.id, prevStatus: c.status }, "[STARTUP] Marked orphaned capture as ended (room gone)");
        }
      }
      if (stale.length > 0) logger.info({ reconciled, skipped, total: stale.length }, "[STARTUP] Reconciliation complete");
    } catch (err: any) {
      logger.error("[STARTUP] Reconciliation failed:", err.message);
    }

    // ── Max call duration enforcer ──
    // Every 60s, check for active captures exceeding 30 minutes.
    // Stops egresses, removes callers, marks capture as ended.
    // Prevents runaway calls from bankrupting us.
    durationCheckInterval = setInterval(async () => {
      try {
        const active = await dbq.findStaleCaptures(); // returns calling + active captures
        for (const c of active) {
          if (c.status !== "active" || !c.startedAt) continue;
          const elapsed = Date.now() - new Date(c.startedAt).getTime();
          if (elapsed < MAX_CALL_DURATION_MS) continue;

          const mins = Math.round(elapsed / 60_000);
          logger.warn({ captureId: c.id, elapsedMinutes: mins }, "[TIMEOUT] Capture exceeded max duration — auto-ending");

          const roomName = c.roomName || `capture-${c.id}`;

          // Stop all active egresses for this room (query LiveKit, don't rely on in-memory cache)
          try {
            const egresses = await egressClient.listEgress({ roomName });
            for (const eg of egresses) {
              if (eg.status === 0 || eg.status === 1) { // EGRESS_STARTING or EGRESS_ACTIVE
                await egressClient.stopEgress(eg.egressId).catch(() => {});
              }
            }
          } catch (e: any) {
            logger.warn({ captureId: c.id, error: e.message }, "[TIMEOUT] Failed to stop egresses");
          }

          // Wait for egresses to finalize (poll until COMPLETE/FAILED, max 15s)
          // Critical: recordings are lost if room is deleted before egress uploads to S3
          const maxWait = 15_000;
          const pollMs = 1000;
          let waited = 0;
          while (waited < maxWait) {
            try {
              const current = await egressClient.listEgress({ roomName });
              const allDone = current.every(eg => eg.status === 3 || eg.status === 4); // COMPLETE or FAILED
              if (allDone || current.length === 0) break;
            } catch {}
            await new Promise((r) => setTimeout(r, pollMs));
            waited += pollMs;
          }
          if (waited >= maxWait) {
            logger.warn({ captureId: c.id }, "[TIMEOUT] Egress finalization timed out after 15s — proceeding cautiously");
          }

          // Remove participants from room (hangs up their calls)
          try {
            const participants = await roomService.listParticipants(roomName);
            for (const p of participants) {
              await roomService.removeParticipant(roomName, p.identity).catch(() => {});
            }
          } catch {}

          // Atomically update DB — only if still "active" (prevents double-processing during rolling deploys)
          const duration = Math.round(elapsed / 1000);
          const { endCaptureIfActive } = await import("@repo/db");
          const updated = await endCaptureIfActive(c.id, new Date(), duration);
          if (!updated) {
            logger.info({ captureId: c.id }, "[TIMEOUT] Capture already ended by another task, skipping");
            continue;
          }

          // Clean up in-memory state if present
          const cached = activeCaptures.get(c.id);
          if (cached) {
            captureActiveGauge.dec();
            cached.status = "ended";
            cached.endedAt = new Date().toISOString();
            cached.durationSeconds = duration;
          }

          // Delete room
          await roomService.deleteRoom(roomName).catch(() => {});

          // Alert
          notifySlackError({
            type: "call-timeout",
            error: `Capture auto-ended after ${mins} minutes (max ${MAX_CALL_DURATION_MS / 60_000}min)`,
            context: { captureId: c.id, elapsedMinutes: mins },
          }).catch(() => {});

          logger.info({ captureId: c.id }, "[TIMEOUT] Capture auto-ended");
        }
      } catch (err: any) {
        logger.error({ error: err.message }, "[TIMEOUT] Duration check failed");
      }
    }, 60_000);
  });

  function shutdown(signal: string) {
    logger.info({ signal }, "Shutting down gracefully...");
    if (durationCheckInterval) clearInterval(durationCheckInterval);
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

