import { Router } from "express";
import * as dbq from "@repo/db";
import { registry } from "../metrics";
import { activeCaptures } from "../services/state";

const router = Router();

router.get("/metrics", async (_req, res) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});

router.get("/health", async (_req, res) => {
  try {
    await dbq.ping();
    res.json({ status: "ok", uptime: Math.round(process.uptime()), activeCaptures: activeCaptures.size });
  } catch {
    res.status(503).json({ status: "degraded", reason: "database unreachable", uptime: Math.round(process.uptime()) });
  }
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
