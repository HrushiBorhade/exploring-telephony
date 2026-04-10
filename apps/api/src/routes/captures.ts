import { Router } from "express";
import crypto from "crypto";
import { requireAuth, requireAdmin, type AuthRequest } from "../middleware/auth";
import { roomService, agentDispatch, egressClient } from "../lib/livekit";
import { audioQueue, csvQueue } from "@repo/queues";
import * as dbq from "@repo/db";
import { logger } from "../logger";
import { env } from "../env";
import { toApiCapture, calculateDuration } from "../lib/helpers";
import { startEgressForCapture } from "../lib/egress";
import { activeCaptures } from "../services/state";
import { captureTotal, captureActiveGauge, callDurationHistogram } from "../metrics";
import type { Capture } from "@repo/types";
const router = Router();

// List captures (cursor-paginated)
router.get("/api/captures", requireAuth, async (req: AuthRequest, res) => {
  try {
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    const rows = await dbq.listCapturesByUser(req.userId!, { cursor, limit });
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    // Merge in-memory active captures with DB rows
    const merged = pageRows.map((row) => activeCaptures.get(row.id) ?? row);

    // On first page (no cursor), prepend in-memory-only captures (newly created, not yet in DB pagination window)
    const items = !cursor
      ? [
          ...Array.from(activeCaptures.values())
            .filter((c) => !pageRows.find((r) => r.id === c.id) && c.userId === req.userId)
            .map(toApiCapture),
          ...merged.map(toApiCapture),
        ]
      : merged.map(toApiCapture);

    const nextCursor = hasMore && pageRows.length > 0
      ? pageRows[pageRows.length - 1].createdAt?.toISOString() ?? null
      : null;

    res.json({ items, nextCursor });
  } catch {
    res.status(500).json({ error: "Failed to list captures" });
  }
});

// Capture stats (aggregate — not dependent on pagination)
router.get("/api/captures/stats", requireAuth, async (req: AuthRequest, res) => {
  try {
    const stats = await dbq.getCaptureStats(req.userId!);
    res.json(stats);
  } catch {
    res.status(500).json({ error: "Failed to get stats" });
  }
});

// Get capture
router.get("/api/captures/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const capture = activeCaptures.get(id) ?? (await dbq.getCapture(id));
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }
  if (capture.userId !== req.userId && req.userRole !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(toApiCapture(capture));
});

// Create capture
router.post("/api/captures", requireAuth, async (req: AuthRequest, res) => {
  const { name, phoneB, language } = req.body;

  if (!phoneB) {
    res.status(400).json({ error: "phoneB is required" });
    return;
  }
  if (!req.userPhone) {
    res.status(400).json({ error: "No phone number on your account" });
    return;
  }

  const id = crypto.randomBytes(6).toString("hex");
  const roomName = `capture-${id}`;
  const capture: Capture = {
    id,
    userId: req.userId!,
    name: name || "",
    phoneA: req.userPhone,
    phoneB,
    language: language || "en",
    status: "created",
    roomName,
    createdAt: new Date().toISOString(),
  };

  activeCaptures.set(id, capture);
  await dbq.createCapture({
    id,
    userId: req.userId!,
    name: capture.name,
    phoneA: capture.phoneA,
    phoneB: capture.phoneB,
    language: capture.language,
    status: "created",
    roomName,
  });

  captureTotal.inc();
  logger.info(`[CAPTURE] Created: ${id}`);
  res.json(capture);
});

// Start capture — create room, dispatch agent (agent handles dialing + consent + announce)
router.post("/api/captures/:id/start", requireAuth, async (req: AuthRequest, res) => {
  const capture = activeCaptures.get(req.params.id as string);
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }
  if (capture.userId !== req.userId && req.userRole !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (capture.status !== "created") {
    res.status(400).json({ error: `Status is ${capture.status}` });
    return;
  }

  capture.status = "calling";
  const roomName = capture.roomName!;

  try {
    // 1. Create room
    await roomService.createRoom({
      name: roomName,
      emptyTimeout: 120,
      departureTimeout: 15,
      maxParticipants: 10,
    });

    // 2. Dispatch agent — it dials phones, handles consent + announce, signals egress
    await agentDispatch.createDispatch(roomName, "telephony-agent", {
      metadata: JSON.stringify({
        captureId: capture.id,
        phoneA: capture.phoneA,
        phoneB: capture.phoneB,
        sipTrunkId: env.LIVEKIT_SIP_TRUNK_ID,
      }),
    });

    capture.startedAt = new Date().toISOString();
    capture.status = "active";
    captureActiveGauge.inc();
    await dbq.updateCapture(capture.id, {
      status: "active",
      startedAt: new Date(capture.startedAt),
    });
    logger.info(`[CAPTURE] Room + agent dispatched: ${roomName}`);
  } catch (err: any) {
    capture.status = "created";
    logger.error("[CAPTURE] Setup failed:", err.message);
    roomService.deleteRoom(roomName).catch(() => {});
    res.status(500).json({ error: err.message });
    return;
  }

  res.json({ status: "calling", roomName });

  // 150s hard deadline — safety net for agent crashes
  const bgDeadline = setTimeout(() => {
    if (capture.status === "active") {
      logger.error({ captureId: capture.id }, "[CAPTURE] Hard timeout (150s)");
      captureActiveGauge.dec();
      capture.status = "ended";
      capture.endedAt = new Date().toISOString();
      capture.durationSeconds = calculateDuration(capture.startedAt);
      dbq.updateCapture(capture.id, {
        status: "ended", endedAt: new Date(), durationSeconds: capture.durationSeconds ?? 0,
      }).catch((e) => logger.error("[CAPTURE] DB sync failed:", e.message));
      roomService.deleteRoom(roomName).catch(() => {});
    }
  }, 150_000);

  // Poll for agent completion — egress start or failure
  (async () => {
    try {
      await new Promise((r) => setTimeout(r, 1000));

      const pollDeadline = Date.now() + 120_000;
      while (Date.now() < pollDeadline && !capture._egressIds?.length && capture.status === "active") {
        try {
          const rooms = await roomService.listRooms([roomName]);
          const room = rooms[0];
          if (room?.metadata) {
            const parsed = JSON.parse(room.metadata);
            if (parsed.announced === true && !capture._egressStarting) {
              logger.info(`[CAPTURE] Agent done — starting egress for ${capture.id}`);
              try {
                await startEgressForCapture(capture, roomName);
              } catch (egressErr: any) {
                logger.error({ captureId: capture.id, error: egressErr.message }, "[CAPTURE] Egress start failed");
                throw new Error(`Agent: egress_start_failed`);
              }
              break;
            }
            if (parsed.announced === false) {
              logger.info({ captureId: capture.id, error: parsed.error }, "[CAPTURE] Agent signaled failure");
              throw new Error(`Agent: ${parsed.error || "consent denied"}`);
            }
          }
        } catch (err: any) {
          if (err.message.startsWith("Agent:")) throw err;
          logger.debug(`[CAPTURE] Poll error: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err: any) {
      logger.error({ reason: err.message, captureId: capture.id }, "[CAPTURE] Flow failed");
      if (capture.status === "active") captureActiveGauge.dec();
      capture.status = "ended";
      capture.endedAt = new Date().toISOString();
      capture.durationSeconds = calculateDuration(capture.startedAt);
      await dbq.updateCapture(capture.id, {
        status: "ended", endedAt: new Date(), durationSeconds: capture.durationSeconds ?? 0,
      }).catch((e) => logger.error({ captureId: capture.id }, "[DB] update failed:", e.message));
      roomService.deleteRoom(roomName).catch(() => {});
    } finally {
      clearTimeout(bgDeadline);
    }
  })();
});

// End capture
router.post("/api/captures/:id/end", requireAuth, async (req: AuthRequest, res) => {
  const capture = activeCaptures.get(req.params.id as string);
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }
  if (capture.userId !== req.userId && req.userRole !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  try {
    // Stop all egresses with synchronized finalization (same as webhook handler)
    if (capture._egressIds?.length) {
      await Promise.all(
        capture._egressIds.map((eid) =>
          egressClient.stopEgress(eid)
            .catch((e: any) => logger.warn(`[CLEANUP] stopEgress ${eid} failed:`, e.message)),
        ),
      );
      logger.info(`[CAPTURE] All egresses stopped for ${capture.id}`);

      // Wait for LiveKit to finalize all egress recordings
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Delete room after egress finalization
    await roomService.deleteRoom(capture.roomName!);
    logger.info(`[CAPTURE] Room deleted: ${capture.roomName}`);

    const wasActive = capture.status === "active";
    capture.status = "ended";
    capture.endedAt = new Date().toISOString();
    capture.durationSeconds = calculateDuration(capture.startedAt);

    if (wasActive) captureActiveGauge.dec();
    if (capture.durationSeconds) callDurationHistogram.observe(capture.durationSeconds);

    await dbq.updateCapture(capture.id, {
      status: "ended",
      endedAt: new Date(capture.endedAt),
      durationSeconds: capture.durationSeconds,
    }).catch((e) => logger.error({ captureId: capture.id }, "[DB] /end update failed:", e.message));

    res.json({ status: "ended", durationSeconds: capture.durationSeconds });
  } catch (err: any) {
    logger.error("[CAPTURE] End failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Edit/delete transcript utterance + trigger CSV regeneration (admin-only)
router.patch("/api/captures/:id/transcript", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const capture = activeCaptures.get(id) ?? (await dbq.getCapture(id));
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }

  const { participant, index, text, action = "edit" } = req.body;
  if (!participant || typeof index !== "number") {
    res.status(400).json({ error: "Required: participant (a|b), index (number)" });
    return;
  }
  if (action !== "edit" && action !== "delete") {
    res.status(400).json({ error: "action must be 'edit' or 'delete'" });
    return;
  }
  if (action === "edit" && typeof text !== "string") {
    res.status(400).json({ error: "Required for edit: text (string)" });
    return;
  }

  try {
    const field = participant === "a" ? "transcriptA" : "transcriptB";
    const raw = (capture as any)[field] as string | null;
    if (!raw) { res.status(400).json({ error: "No transcript for this participant" }); return; }

    const utterances = JSON.parse(raw);
    if (index < 0 || index >= utterances.length) {
      const rangeMsg = utterances.length === 0
        ? "transcript is empty"
        : `valid range is 0-${utterances.length - 1}`;
      res.status(400).json({ error: `Index ${index} out of bounds: ${rangeMsg}` });
      return;
    }

    if (action === "delete") {
      utterances.splice(index, 1);
    } else {
      utterances[index].text = text;
    }
    const updated = JSON.stringify(utterances);

    await dbq.updateCapture(id, { [field]: updated });
    logger.info({ captureId: id, participant, index, action }, "[CAPTURE] Transcript modified");

    // Enqueue lightweight CSV regeneration (no re-transcription)
    await csvQueue.add("csv-regen", { captureId: id }, {
      jobId: `csv-regen-${id}-${Date.now()}`,
    });

    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ captureId: id, error: err.message }, "[CAPTURE] Transcript modify failed");
    res.status(500).json({ error: err.message });
  }
});

// Admin: verify a capture (sets verified = true)
router.post("/api/captures/:id/verify", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  try {
    const capture = await dbq.getCapture(id);
    if (!capture) { res.status(404).json({ error: "Not found" }); return; }
    if (capture.status !== "completed") {
      res.status(400).json({ error: `Cannot verify: status is ${capture.status}, expected completed` });
      return;
    }
    if (capture.verified === true) {
      res.status(400).json({ error: "Capture is already verified" });
      return;
    }
    await dbq.updateCapture(id, { verified: true });
    logger.info({ captureId: id, adminId: req.userId }, "[CAPTURE] Verified by admin");
    res.json({ ok: true, verified: true });
  } catch (err: any) {
    logger.error({ captureId: id, error: err.message }, "[CAPTURE] Verify failed");
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Admin endpoints
// ═══════════════════════════════════════════════════════════════════

// Admin: platform-wide stats
router.get("/api/admin/stats", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const stats = await dbq.getAdminStats();
    res.json(stats);
  } catch {
    res.status(500).json({ error: "Failed to get admin stats" });
  }
});

// Admin: list all captures across all users
router.get("/api/admin/captures", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    const rows = await dbq.listAllCaptures({ cursor, limit });
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      items: pageRows.map(toApiCapture),
      nextCursor: hasMore && pageRows.length > 0
        ? pageRows[pageRows.length - 1].createdAt?.toISOString() ?? null
        : null,
    });
  } catch {
    res.status(500).json({ error: "Failed to list captures" });
  }
});

// Admin: reprocess all completed captures (re-transcribe + re-clip + re-csv)
router.post("/api/admin/reprocess-all", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const rows = await dbq.listAllCaptures({ limit: 200 });
    const completed = rows.filter(
      (r) => r.status === "completed" && r.recordingUrl && r.recordingUrlA && r.recordingUrlB,
    );

    const jobs = [];
    for (const cap of completed) {
      await audioQueue.add(
        "process-audio",
        {
          captureId: cap.id,
          mixedUrl: cap.recordingUrl!,
          callerAUrl: cap.recordingUrlA!,
          callerBUrl: cap.recordingUrlB!,
        },
        { jobId: `reprocess-${cap.id}-${Date.now()}` },
      );
      await dbq.updateCapture(cap.id, { status: "processing" });
      jobs.push(cap.id);
    }

    logger.info({ count: jobs.length, ids: jobs }, "[ADMIN] Reprocessing all captures");
    res.json({ requeued: jobs.length, captureIds: jobs });
  } catch (err: any) {
    logger.error({ error: err.message }, "[ADMIN] Reprocess failed");
    res.status(500).json({ error: "Failed to reprocess" });
  }
});

export default router;
