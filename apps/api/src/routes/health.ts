import { Router } from "express";
import * as dbq from "@repo/db";
import { audioQueue, csvQueue } from "@repo/queues";
import { roomService } from "../lib/livekit";
import { registry, queueDepth } from "../metrics";
import { activeCaptures } from "../services/state";
import { logger } from "../logger";

const router = Router();

router.get("/metrics", async (_req, res) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});

/**
 * Health check — verifies all critical dependencies.
 * ALB uses this endpoint. If any dependency is down, returns 503
 * which triggers CloudWatch alarm → SNS → email alert.
 */
router.get("/health", async (_req, res) => {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};
  let allOk = true;

  // Database (PostgreSQL)
  try {
    const start = Date.now();
    await dbq.ping();
    checks.database = { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    checks.database = { ok: false, error: err.message?.slice(0, 100) };
    allOk = false;
  }

  // Redis (BullMQ queue connection)
  try {
    const start = Date.now();
    const client = await audioQueue.client;
    const pong = await client.ping();
    checks.redis = { ok: pong === "PONG", latencyMs: Date.now() - start };
    if (pong !== "PONG") allOk = false;
  } catch (err: any) {
    checks.redis = { ok: false, error: err.message?.slice(0, 100) };
    allOk = false;
  }

  // LiveKit (room service reachability)
  try {
    const start = Date.now();
    await roomService.listRooms([]);
    checks.livekit = { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    checks.livekit = { ok: false, error: err.message?.slice(0, 100) };
    // LiveKit down is degraded but not fatal — calls won't work but API still serves data
  }

  // Check for stale captures (stuck in calling/active for > 5 minutes)
  let staleCaptures = 0;
  try {
    const stale = await dbq.findStaleCaptures();
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    staleCaptures = stale.filter((c) => {
      const created = c.createdAt ? new Date(c.createdAt).getTime() : 0;
      return created < fiveMinutesAgo;
    }).length;
  } catch {}

  // Queue health metrics (BullMQ audio + csv queues)
  let queueHealth = {
    audio: { waiting: 0, active: 0, failed: 0 },
    csv: { waiting: 0, active: 0, failed: 0 },
  };
  try {
    const [aw, aa, af, cw, ca, cf] = await Promise.all([
      audioQueue.getWaitingCount(),
      audioQueue.getActiveCount(),
      audioQueue.getFailedCount(),
      csvQueue.getWaitingCount(),
      csvQueue.getActiveCount(),
      csvQueue.getFailedCount(),
    ]);
    queueHealth = {
      audio: { waiting: aw, active: aa, failed: af },
      csv: { waiting: cw, active: ca, failed: cf },
    };

    // Update Prometheus gauges
    queueDepth.set({ queue: "audio", state: "waiting" }, aw);
    queueDepth.set({ queue: "audio", state: "active" }, aa);
    queueDepth.set({ queue: "audio", state: "failed" }, af);
    queueDepth.set({ queue: "csv", state: "waiting" }, cw);
    queueDepth.set({ queue: "csv", state: "active" }, ca);
    queueDepth.set({ queue: "csv", state: "failed" }, cf);
  } catch {}

  // Determine overall status:
  // - DB or Redis down → 503 "degraded"
  // - Stale captures or high queue failures → 200 "degraded" (system works but needs attention)
  const isDegraded = staleCaptures > 0 || queueHealth.audio.failed > 10;
  const status = allOk ? (isDegraded ? "degraded" : "ok") : "degraded";
  const httpCode = allOk ? 200 : 503;

  if (!allOk || isDegraded) {
    logger.warn({ checks, staleCaptures, queueHealth }, "[HEALTH] Service degraded");
  }

  res.status(httpCode).json({
    status,
    uptime: Math.round(process.uptime()),
    activeCaptures: activeCaptures.size,
    staleCaptures,
    queueHealth,
    checks,
  });
});

router.get("/ready", async (_req, res) => {
  try {
    await dbq.ping();
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not ready", reason: "database unreachable" });
  }
});

export default router;
