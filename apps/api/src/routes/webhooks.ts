import { Router } from "express";
import { WebhookReceiver } from "livekit-server-sdk";
import { roomService, egressClient } from "../lib/livekit";
import * as dbq from "@repo/db";
import { calculateDuration } from "../lib/helpers";
import { startEgressForCapture } from "../lib/egress";
import { audioQueue } from "@repo/queues";
import { logger } from "../logger";
import { env } from "../env";
import { activeCaptures, findCaptureByRoom } from "../services/state";
import {
  captureActiveGauge,
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

    // ── room_metadata_changed: agent signals announced:true (start egress) or announced:false (failure) ──
    if (event.event === "room_metadata_changed" && event.room?.name && event.room?.metadata) {
      const roomName = event.room.name;
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(event.room.metadata); } catch { /* not JSON */ }

      if (roomName.startsWith("capture-")) {
        const capture = findCaptureByRoom(roomName);

        // Agent completed successfully → start all 3 egresses
        if (parsed.announced === true && capture && capture.status === "active") {
          try {
            await startEgressForCapture(capture, roomName);
            logger.info(`[WEBHOOK] Egress started for ${roomName}`);
          } catch (err: any) {
            logger.error(`[WEBHOOK] Failed to start egress:`, err.message);
          }
        }

        // Agent signaled failure (consent denied, timeout, disconnect)
        if (parsed.announced === false && capture && (capture.status === "active" || capture.status === "calling")) {
          logger.info({ captureId: capture.id, error: parsed.error }, "[WEBHOOK] Agent signaled failure");
          if (capture.status === "active") captureActiveGauge.dec();
          capture.status = "ended";
          capture.endedAt = new Date().toISOString();
          capture.durationSeconds = 0;
          await dbq.updateCapture(capture.id, {
            status: "ended", endedAt: new Date(), durationSeconds: 0,
          }).catch((e) => logger.error("[DB] metadata failure update failed:", e.message));
          roomService.deleteRoom(roomName).catch(() => {});
        }
      }
    }

    // ── participant_joined (tracking only — egress starts after announcement) ────────────
    if (event.event === "participant_joined" && event.room && event.participant) {
      const roomName = event.room.name;
      const identity = event.participant.identity;

      if ((identity === "caller_a" || identity === "caller_b") && roomName.startsWith("capture-")) {
        const capture = findCaptureByRoom(roomName);
        if (capture) {
          if (!capture._joinedCallers) capture._joinedCallers = new Set();
          capture._joinedCallers.add(identity);
          logger.info(`[WEBHOOK] ${identity} joined ${roomName}. Callers in room: ${[...capture._joinedCallers].join(", ")}`);
        }
      }
    }

    // ── participant_left ────────────
    if (event.event === "participant_left" && event.room && event.participant) {
      const roomName = event.room.name;
      const identity = event.participant.identity;

      // ── Capture room: caller left during recording → stop egress + cleanup
      // Only handle "active" status — during "calling" (consent phase), SIP bridges
      // can flicker (connection_aborted → participant_left → re-join). The agent
      // handles consent timeouts internally. Don't abort prematurely.
      if ((identity === "caller_a" || identity === "caller_b") && roomName.startsWith("capture-")) {
        const capture = findCaptureByRoom(roomName);
        if (capture && capture.status === "active") {
          capture._joinedCallers?.delete(identity);
          const remaining = capture._joinedCallers?.size ?? 0;
          logger.info(`[WEBHOOK] ${identity} left ${roomName}. Callers remaining: ${remaining}`);

          // CRITICAL: Stop all egresses FIRST for synchronized recording duration
          // This must happen before any participant removal or room deletion
          if (capture._egressIds?.length) {
            try {
              await Promise.all(
                capture._egressIds.map((eid) =>
                  egressClient.stopEgress(eid)
                    .catch((e: any) => logger.warn(`[CLEANUP] stopEgress ${eid} failed:`, e.message)),
                ),
              );
              logger.info(`[WEBHOOK] All egresses stopped for ${capture.id}`);

              // Wait for LiveKit to finalize recordings (important!)
              // RoomCompositeEgress needs time to flush buffered audio before room deletion
              await new Promise((r) => setTimeout(r, 1000));
            } catch (err: any) {
              logger.error(`[WEBHOOK] Egress stop failed:`, err.message);
            }
          }

          // Update capture status AFTER egress is stopped
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

          // Remove the other caller after egress is stopped
          if (remaining > 0) {
            const otherCaller = identity === "caller_a" ? "caller_b" : "caller_a";
            logger.info(`[WEBHOOK] Removing ${otherCaller} from ${roomName} (partner left)`);
            roomService.removeParticipant(roomName, otherCaller)
              .catch((e) => logger.warn(`[CLEANUP] removeParticipant ${otherCaller} failed:`, e.message));
          }

          // Finally, delete room (after egress stopped and finalized)
          roomService.deleteRoom(roomName).catch((e) => logger.warn("[CLEANUP] deleteRoom failed:", e.message));
        }
      }
    }

    // ── room_finished (fallback) ────────────
    if (event.event === "room_finished" && event.room) {
      const roomName = event.room.name;
      const capture = findCaptureByRoom(roomName);
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

        const cached = activeCaptures.get(row.id);
        if (cached) cached[field] = fileUrl;

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
