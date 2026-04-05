import { Router } from "express";
import { WebhookReceiver } from "livekit-server-sdk";
import { roomService, egressClient } from "../lib/livekit";
import * as dbq from "@repo/db";
import { createS3FileOutput } from "../lib/s3";
import { calculateDuration } from "../lib/helpers";
import { audioQueue } from "@repo/queues";
import { logger } from "../logger";
import { env } from "../env";
import { activeCaptures } from "../services/state";
import { consentResolvers } from "../services/consent";
import {
  captureActiveGauge,
  egressSuccessTotal,
  egressFailureTotal,
  webhookDurationHistogram,
} from "../metrics";

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, S3_BUCKET } = env;
const webhookReceiver = new WebhookReceiver(LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!);

const router = Router();

router.post("/livekit/webhook", async (req, res) => {
  const webhookStart = Date.now();
  let event: any;
  try {
    const body = req.body.toString();
    const authHeader = req.get("Authorization") || "";
    event = await webhookReceiver.receive(body, authHeader);
  } catch (err: any) {
    logger.error("[WEBHOOK] Signature verification failed:", err.message);
    res.sendStatus(401);
    return;
  }

  res.sendStatus(200);

  try {
    logger.info(`[WEBHOOK] ${event.event}`);

    // ── Consent resolution via webhook ────────────
    if (event.event === "room_metadata_changed" && event.room?.name && event.room?.metadata) {
      logger.info({ roomName: event.room.name, metadata: event.room.metadata, resolverExists: consentResolvers.has(event.room.name), resolverKeys: Array.from(consentResolvers.keys()) }, "[WEBHOOK] room_metadata_changed DEBUG");
      const resolver = consentResolvers.get(event.room.name);
      if (resolver) {
        try {
          const parsed = JSON.parse(event.room.metadata);
          if (parsed.consent === true) {
            logger.info(`[WEBHOOK] Consent GRANTED for ${event.room.name}`);
            resolver(true);
          } else if (parsed.consent === false) {
            logger.info(`[WEBHOOK] Consent DENIED for ${event.room.name}`);
            resolver(false);
          }
        } catch { /* metadata not consent JSON */ }
      }
    }

    // ── participant_joined ────────────
    if (event.event === "participant_joined" && event.room && event.participant) {
      const roomName = event.room.name;
      const identity = event.participant.identity;

      if ((identity === "caller_a" || identity === "caller_b") && roomName.startsWith("capture-")) {
        const capture = Array.from(activeCaptures.values()).find((c) => c.roomName === roomName);
        if (capture) {
          if (!capture._joinedCallers) capture._joinedCallers = new Set();
          capture._joinedCallers.add(identity);
          const joined = capture._joinedCallers;
          logger.info(`[WEBHOOK] ${identity} joined ${roomName}. Callers in room: ${[...joined].join(", ")}`);

          if (joined.size >= 2 && !capture._egressStarting && !capture.egressId && capture.status !== "ended") {
            capture._egressStarting = true;
            capture.egressId = "PENDING";
            try {
              await new Promise((r) => setTimeout(r, 1000));

              const mixedOutput = createS3FileOutput(capture.id);
              const mixedEgress = await egressClient.startRoomCompositeEgress(
                roomName, { file: mixedOutput }, { audioOnly: true },
              );
              capture.egressId = mixedEgress.egressId;
              await dbq.updateCapture(capture.id, { egressId: capture.egressId })
                .catch((e) => logger.error({ captureId: capture.id }, "[DB] egressId update failed:", e.message));
              logger.info(`[WEBHOOK] Mixed egress started: ${mixedEgress.egressId}`);

              for (const callerId of ["caller_a", "caller_b"]) {
                try {
                  const speakerOutput = createS3FileOutput(capture.id, callerId);
                  await egressClient.startParticipantEgress(roomName, callerId, { file: speakerOutput });
                  egressSuccessTotal.inc({ type: callerId });
                  logger.info(`[WEBHOOK] ${callerId} egress started`);
                } catch (err: any) {
                  egressFailureTotal.inc();
                  logger.error(`[WEBHOOK] ${callerId} egress failed:`, err.message);
                }
              }
            } catch (err: any) {
              capture.egressId = undefined;
              capture._egressStarting = false;
              egressFailureTotal.inc();
              logger.error(`[WEBHOOK] Failed to start egress:`, err.message);
            }
          }
        }
      }
    }

    // ── participant_left ────────────
    if (event.event === "participant_left" && event.room && event.participant) {
      const roomName = event.room.name;
      const identity = event.participant.identity;

      // ── Capture room: caller left → remove the other caller immediately
      if ((identity === "caller_a" || identity === "caller_b") && roomName.startsWith("capture-")) {
        const capture = Array.from(activeCaptures.values()).find((c) => c.roomName === roomName);
        if (capture) {
          capture._joinedCallers?.delete(identity);
          const remaining = capture._joinedCallers?.size ?? 0;
          logger.info(`[WEBHOOK] ${identity} left ${roomName}. Callers remaining: ${remaining}`);

          // Immediately disconnect the other caller — don't leave them hanging
          if (remaining > 0 && capture.status === "active") {
            const otherCaller = identity === "caller_a" ? "caller_b" : "caller_a";
            logger.info(`[WEBHOOK] Removing ${otherCaller} from ${roomName} (partner left)`);
            roomService.removeParticipant(roomName, otherCaller)
              .catch((e) => logger.warn(`[CLEANUP] removeParticipant ${otherCaller} failed:`, e.message));
          }

          if (capture.status === "active") {
            captureActiveGauge.dec();
            capture.status = "ended";
            capture.endedAt = new Date().toISOString();
            capture.durationSeconds = calculateDuration(capture.startedAt);
            await dbq.updateCapture(capture.id, {
              status: "ended",
              endedAt: new Date(capture.endedAt),
              durationSeconds: capture.durationSeconds,
            }).catch((e) => logger.error({ captureId: capture.id }, "[DB] participant_left update failed:", e.message));
            logger.info(`[WEBHOOK] Capture ${capture.id} ended (caller left)`);

            roomService.deleteRoom(roomName).catch((e) => logger.warn("[CLEANUP]", e.message));
          }
        }
      }
    }

    // ── room_finished (fallback) ────────────
    if (event.event === "room_finished" && event.room) {
      const roomName = event.room.name;
      const capture = Array.from(activeCaptures.values()).find((c) => c.roomName === roomName);
      if (capture && capture.status === "active") {
        captureActiveGauge.dec();
        capture.status = "ended";
        capture.endedAt = new Date().toISOString();
        capture.durationSeconds = calculateDuration(capture.startedAt);
        await dbq.updateCapture(capture.id, {
          status: "ended",
          endedAt: new Date(capture.endedAt),
          durationSeconds: capture.durationSeconds,
        }).catch((e) => logger.error("[DB] room_finished update failed:", e.message));
        logger.info(`[WEBHOOK] Capture ${capture.id} ended (room finished)`);
      }
    }

    // ── egress_ended ────────────
    // Each capture produces 3 egress events (mixed, caller_a, caller_b).
    // We atomically save each URL + check if all 3 are ready. Only the
    // webhook that completes the set enqueues the processing job.
    if (event.event === "egress_ended" && event.egressInfo) {
      const egressId = event.egressInfo.egressId;
      const roomName = event.egressInfo.roomName;

      const fileResults = event.egressInfo.fileResults ?? [];
      const rawPath = fileResults[0]?.location || fileResults[0]?.filename
        || (event.egressInfo as any).trackResults?.[0]?.location
        || (event.egressInfo as any).trackResults?.[0]?.filename;

      const s3PublicBase = env.S3_PUBLIC_URL || `https://${S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com`;
      const fileUrl = rawPath && !rawPath.startsWith("http")
        ? `${s3PublicBase}/${rawPath}`
        : rawPath;

      logger.info({ egressId, roomName, fileUrl }, "[WEBHOOK] Egress complete");

      let row = await dbq.findCaptureByEgressId(egressId);
      if (!row && roomName) {
        row = await dbq.findCaptureByRoomName(roomName) ?? undefined;
      }

      if (row && fileUrl) {
        // Detect recording type from S3 path
        // LiveKit egress paths: recordings/{captureId}-mixed.mp4, recordings/{captureId}-caller_a.mp4
        const pathLower = fileUrl.toLowerCase();
        let field: "recordingUrl" | "recordingUrlA" | "recordingUrlB" = "recordingUrl";
        if (pathLower.includes("caller_a") || pathLower.includes("participant-a")) {
          field = "recordingUrlA";
        } else if (pathLower.includes("caller_b") || pathLower.includes("participant-b")) {
          field = "recordingUrlB";
        }

        // Compute duration if not yet set
        const extra: Record<string, any> = {};
        if (!row.durationSeconds && row.startedAt) {
          const endTime = row.endedAt ? new Date(row.endedAt).getTime() : Date.now();
          extra.durationSeconds = Math.round((endTime - new Date(row.startedAt).getTime()) / 1000);
          extra.endedAt = row.endedAt ?? new Date();
        }

        // Atomic: set this URL + check if all 3 are now present
        // Returns the row ONLY if this was the update that completed the set
        // AND status is still "ended" (prevents duplicate enqueue)
        const ready = await dbq.setRecordingUrlAndCheckReady(row.id, field, fileUrl, extra);

        logger.info({ captureId: row.id, field }, "[WEBHOOK] Recording URL saved");

        // Update in-memory cache
        const cached = activeCaptures.get(row.id);
        if (cached) {
          if (field === "recordingUrl") cached.recordingUrl = fileUrl;
          if (field === "recordingUrlA") cached.recordingUrlA = fileUrl;
          if (field === "recordingUrlB") cached.recordingUrlB = fileUrl;
        }

        // If this webhook completed the set → enqueue processing job
        if (ready) {
          logger.info({ captureId: row.id }, "[WEBHOOK] All 3 recordings ready — enqueueing processing job");

          await audioQueue.add(
            "process-audio",
            {
              captureId: ready.id,
              mixedUrl: ready.recordingUrl!,
              callerAUrl: ready.recordingUrlA!,
              callerBUrl: ready.recordingUrlB!,
            },
            { jobId: `process-${ready.id}` },
          );

          await dbq.updateCapture(ready.id, { status: "processing" });
          setTimeout(() => activeCaptures.delete(ready.id), 10_000);
        }
      }
    }
  } catch (err: any) {
    logger.error("[WEBHOOK] Error:", err.message);
  } finally {
    webhookDurationHistogram.observe({ event: "webhook" }, Date.now() - webhookStart);
  }
});

export default router;
