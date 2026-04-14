import { Router } from "express";
import * as dbq from "@repo/db";
import { audioQueue } from "@repo/queues";
import { roomService } from "../lib/livekit";
import { registry } from "../metrics";
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

  const status = allOk ? "ok" : "degraded";
  const httpCode = allOk ? 200 : 503;

  if (!allOk) {
    logger.warn({ checks }, "[HEALTH] Service degraded");
  }

  res.status(httpCode).json({
    status,
    uptime: Math.round(process.uptime()),
    activeCaptures: activeCaptures.size,
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
