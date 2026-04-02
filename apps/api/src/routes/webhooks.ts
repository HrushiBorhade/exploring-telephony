import { Router } from "express";
import { WebhookReceiver } from "livekit-server-sdk";
import { roomService, egressClient } from "../lib/livekit";
import * as dbq from "@repo/db";
import { downloadRecording } from "../lib/audio";
import { createS3FileOutput } from "../lib/s3";
import { calculateDuration } from "../lib/helpers";
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

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, S3_BUCKET, S3_ENDPOINT } = env;
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

      if ((identity === "caller_a" || identity === "caller_b") && roomName.startsWith("capture-")) {
        const capture = Array.from(activeCaptures.values()).find((c) => c.roomName === roomName);
        if (capture) {
          capture._joinedCallers?.delete(identity);
          const remaining = capture._joinedCallers?.size ?? 0;
          logger.info(`[WEBHOOK] ${identity} left ${roomName}. Callers remaining: ${remaining}`);

          if (remaining === 0 && capture.status === "active") {
            captureActiveGauge.dec();
            capture.status = "ended";
            capture.endedAt = new Date().toISOString();
            capture.durationSeconds = calculateDuration(capture.startedAt);
            await dbq.updateCapture(capture.id, {
              status: "ended",
              endedAt: new Date(capture.endedAt),
              durationSeconds: capture.durationSeconds,
            }).catch((e) => logger.error({ captureId: capture.id }, "[DB] participant_left update failed:", e.message));
            logger.info(`[WEBHOOK] Capture ${capture.id} ended (all callers left)`);

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
    if (event.event === "egress_ended" && event.egressInfo) {
      const egressId = event.egressInfo.egressId;
      const roomName = event.egressInfo.roomName;

      const fileResults = event.egressInfo.fileResults ?? [];
      const rawPath = fileResults[0]?.location || fileResults[0]?.filename
        || (event.egressInfo as any).trackResults?.[0]?.location
        || (event.egressInfo as any).trackResults?.[0]?.filename;

      const fileUrl = rawPath && !rawPath.startsWith("http")
        ? `${S3_ENDPOINT}/${S3_BUCKET}/${rawPath}`
        : rawPath;

      logger.info(`[WEBHOOK] Egress complete: ${egressId}, room: ${roomName}, file: ${fileUrl}`);

      let row = await dbq.findCaptureByEgressId(egressId);
      if (!row && roomName) {
        row = await dbq.findCaptureByRoomName(roomName) ?? undefined;
      }

      if (row && fileUrl) {
        const filepath = fileUrl.toLowerCase();
        const isMixed = filepath.includes("-mixed");
        const isCallerA = filepath.includes("-caller_a");
        const isCallerB = filepath.includes("-caller_b");

        const recordingUpdate: Record<string, any> = {};
        if (isMixed) {
          const localPath = await downloadRecording(fileUrl, `${row.id}-mixed.ogg`).catch((err) => {
            logger.error("[WEBHOOK] Download failed:", err.message);
            return null;
          });
          recordingUpdate.recordingUrl = fileUrl;
          recordingUpdate.localRecordingPath = localPath;
        } else if (isCallerA) {
          recordingUpdate.recordingUrlA = fileUrl;
        } else if (isCallerB) {
          recordingUpdate.recordingUrlB = fileUrl;
        } else {
          const localPath = await downloadRecording(fileUrl, `${row.id}-mixed.ogg`).catch(() => null);
          recordingUpdate.recordingUrl = fileUrl;
          recordingUpdate.localRecordingPath = localPath;
        }

        recordingUpdate.status = "completed";
        if (!row.durationSeconds && row.startedAt) {
          const endTime = row.endedAt ? new Date(row.endedAt).getTime() : Date.now();
          recordingUpdate.durationSeconds = Math.round((endTime - new Date(row.startedAt).getTime()) / 1000);
          recordingUpdate.endedAt = row.endedAt ?? new Date();
        }
        await dbq.updateCapture(row.id, recordingUpdate);
        logger.info(`[WEBHOOK] Recording saved for ${row.id} (${isMixed ? "mixed" : isCallerA ? "caller_a" : "caller_b"})`);

        const cached = activeCaptures.get(row.id);
        if (cached) {
          cached.status = "completed";
          if (isMixed) cached.recordingUrl = fileUrl;
          if (isCallerA) cached.recordingUrlA = fileUrl;
          if (isCallerB) cached.recordingUrlB = fileUrl;
        }

        if (isMixed) {
          setTimeout(() => activeCaptures.delete(row.id), 10000);
          logger.info(`[WEBHOOK] Capture ${row.id} completed (duration: ${recordingUpdate.durationSeconds ?? 'n/a'}s)`);
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
