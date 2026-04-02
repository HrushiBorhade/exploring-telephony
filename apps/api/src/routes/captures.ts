import { Router } from "express";
import crypto from "crypto";
import { TwirpError } from "livekit-server-sdk";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { roomService, sipClient, agentDispatch } from "../lib/livekit";
import * as dbq from "@repo/db";
import { logger } from "../logger";
import { env } from "../env";
import { toApiCapture, calculateDuration } from "../lib/helpers";
import { activeCaptures } from "../services/state";
import { waitForConsent } from "../services/consent";
import { captureTotal, captureActiveGauge, callDurationHistogram } from "../metrics";
import type { Capture } from "@repo/types";

const { LIVEKIT_SIP_TRUNK_ID } = env;
const router = Router();

// List captures
router.get("/api/captures", requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbCaptures = await dbq.listCapturesByUser(req.userId!);
    const merged = dbCaptures.map((row) => activeCaptures.get(row.id) ?? row);
    const inMemoryOnly = Array.from(activeCaptures.values()).filter(
      (c) => !dbCaptures.find((r) => r.id === c.id) && c.userId === req.userId
    );
    res.json([...merged, ...inMemoryOnly].map(toApiCapture));
  } catch {
    res.status(500).json({ error: "Failed to list captures" });
  }
});

// Get capture
router.get("/api/captures/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const capture = activeCaptures.get(id) ?? (await dbq.getCapture(id));
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }
  if (capture.userId !== req.userId) {
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

// Start capture — 3-room consent + parallel dial
router.post("/api/captures/:id/start", requireAuth, async (req: AuthRequest, res) => {
  const capture = activeCaptures.get(req.params.id as string);
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }
  if (capture.userId !== req.userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (capture.status !== "created") {
    res.status(400).json({ error: `Status is ${capture.status}` });
    return;
  }

  capture.status = "calling";

  const consentRoomA = `consent-${capture.id}-a`;
  const consentRoomB = `consent-${capture.id}-b`;

  try {
    await Promise.all([
      roomService.createRoom({ name: consentRoomA, emptyTimeout: 120, maxParticipants: 4 }),
      roomService.createRoom({ name: consentRoomB, emptyTimeout: 120, maxParticipants: 4 }),
      roomService.createRoom({ name: capture.roomName!, emptyTimeout: 300, maxParticipants: 10 }),
    ]);
    logger.info(`[CAPTURE] Rooms created: ${consentRoomA}, ${consentRoomB}, ${capture.roomName}`);

    await Promise.all([
      agentDispatch.createDispatch(consentRoomA, "consent-agent"),
      agentDispatch.createDispatch(consentRoomB, "consent-agent"),
    ]);
    logger.info(`[CAPTURE] Consent agents dispatched`);

    await dbq.updateCapture(capture.id, { status: "calling" });
  } catch (err: any) {
    capture.status = "created";
    logger.error("[CAPTURE] Setup failed:", err.message);
    roomService.deleteRoom(consentRoomA).catch(() => {});
    roomService.deleteRoom(consentRoomB).catch(() => {});
    roomService.deleteRoom(capture.roomName!).catch(() => {});
    res.status(500).json({ error: err.message });
    return;
  }

  res.json({ status: "calling", roomName: capture.roomName });

  // Background: 90s hard deadline
  const bgDeadline = setTimeout(() => {
    if (capture.status === "calling") {
      logger.error({ captureId: capture.id }, "[CAPTURE] Background flow timed out (90s)");
      capture.status = "ended";
      capture.endedAt = new Date().toISOString();
      capture.durationSeconds = 0;
      dbq.updateCapture(capture.id, { status: "ended", endedAt: new Date(), durationSeconds: 0 })
        .catch((e) => logger.error("[CAPTURE] DB sync failed:", e.message));
      roomService.deleteRoom(consentRoomA).catch((e) => logger.warn("[CLEANUP]", e.message));
      roomService.deleteRoom(consentRoomB).catch((e) => logger.warn("[CLEANUP]", e.message));
      roomService.deleteRoom(capture.roomName!).catch((e) => logger.warn("[CLEANUP]", e.message));
    }
  }, 90_000);

  (async () => {
    const cleanupRoom = (name: string) =>
      roomService.deleteRoom(name).catch((e) => logger.warn({ room: name }, "[CLEANUP] deleteRoom failed:", e.message));
    const cleanup = () => Promise.all([cleanupRoom(consentRoomA), cleanupRoom(consentRoomB), cleanupRoom(capture.roomName!)]);

    try {
      const RING_TIMEOUT_MS = 30_000;
      const ringTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Ring timeout: phones didn't answer within 30s")), RING_TIMEOUT_MS),
      );

      const dialBoth = Promise.all([
        sipClient.createSipParticipant(LIVEKIT_SIP_TRUNK_ID!, capture.phoneA, consentRoomA, {
          participantIdentity: "caller_a", participantName: "Phone A",
          krispEnabled: true, waitUntilAnswered: true,
        }),
        sipClient.createSipParticipant(LIVEKIT_SIP_TRUNK_ID!, capture.phoneB, consentRoomB, {
          participantIdentity: "caller_b", participantName: "Phone B",
          krispEnabled: true, waitUntilAnswered: true,
        }),
      ]);

      await Promise.race([dialBoth, ringTimeout]);
      logger.info(`[CAPTURE] Both phones answered`);

      const [consentA, consentB] = await Promise.all([
        waitForConsent(consentRoomA),
        waitForConsent(consentRoomB),
      ]);

      if (!consentA || !consentB) {
        logger.info({ consentA, consentB, captureId: capture.id }, "[CAPTURE] Consent denied");
        throw new Error("Consent denied");
      }

      logger.info(`[CAPTURE] Both consented — moving to ${capture.roomName}`);

      await Promise.all([
        roomService.moveParticipant(consentRoomA, "caller_a", capture.roomName!),
        roomService.moveParticipant(consentRoomB, "caller_b", capture.roomName!),
      ]);

      capture.startedAt = new Date().toISOString();
      capture.status = "active";
      captureActiveGauge.inc();
      await dbq.updateCapture(capture.id, {
        status: "active",
        startedAt: new Date(capture.startedAt),
      });
      logger.info(`[CAPTURE] Active: ${capture.id}`);

      cleanupRoom(consentRoomA);
      cleanupRoom(consentRoomB);

    } catch (err: any) {
      const sipCode = err instanceof TwirpError ? err.metadata?.["sip_status_code"] : undefined;
      logger.error({ sipCode, reason: err.message, captureId: capture.id }, "[CAPTURE] Call failed");

      capture.status = "ended";
      capture.endedAt = new Date().toISOString();
      capture.durationSeconds = 0;
      await dbq.updateCapture(capture.id, {
        status: "ended", endedAt: new Date(), durationSeconds: 0,
      }).catch((e) => logger.error({ captureId: capture.id }, "[DB] Failed to update ended:", e.message));
      await cleanup();
    } finally {
      clearTimeout(bgDeadline);
    }
  })();
});

// End capture
router.post("/api/captures/:id/end", requireAuth, async (req: AuthRequest, res) => {
  const capture = activeCaptures.get(req.params.id as string);
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }
  if (capture.userId !== req.userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  try {
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

export default router;
