import "dotenv/config";
// Telemetry must be initialized before any other imports
import { initTelemetry, shutdownTelemetry } from "./telemetry";
initTelemetry();

import express from "express";
import crypto from "crypto";
import { logger } from "./logger";
import { env } from "./env";
import { requireAuth, type AuthRequest } from "./middleware/auth";
import {
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
  WebhookReceiver,
  TwirpError,
  AgentDispatchClient,
} from "livekit-server-sdk";
import { roomService, sipClient, egressClient, agentDispatch } from "./livekit";
import * as dbq from "@repo/db";
import { downloadRecording, getRecordingPath, recordingExists } from "./audio";
import {
  registry,
  captureTotal,
  captureActiveGauge,
  callDurationHistogram,
  egressSuccessTotal,
  egressFailureTotal,
  webhookDurationHistogram,
} from "./metrics";
import type { Capture } from "@repo/types";

// ════════════════════════════════════════════════════════════════════
// Config
// ════════════════════════════════════════════════════════════════════

// All env vars validated by src/env.ts at import time (zod schema)
const { LIVEKIT_SIP_TRUNK_ID, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
  S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_REGION, S3_ENDPOINT, PORT } = env;

// Catch unhandled promise rejections
process.on("unhandledRejection", (reason: any) => {
  logger.error("[UNHANDLED]", reason?.message ?? reason);
});

// LiveKit webhook receiver for verifying webhook signatures
const webhookReceiver = new WebhookReceiver(LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!);

// ════════════════════════════════════════════════════════════════════
// In-memory cache for active captures
// ════════════════════════════════════════════════════════════════════

const activeCaptures = new Map<string, Capture>();

// ════════════════════════════════════════════════════════════════════
// S3 output helper
// ════════════════════════════════════════════════════════════════════

function createS3FileOutput(captureId: string): EncodedFileOutput {
  return new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: `recordings/${captureId}-mixed.mp4`,
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey: S3_ACCESS_KEY!,
        secret: S3_SECRET_KEY!,
        bucket: S3_BUCKET!,
        region: S3_REGION || "auto",
        endpoint: S3_ENDPOINT || "",
        forcePathStyle: true,
      }),
    },
  });
}

// ════════════════════════════════════════════════════════════════════
// Express app
// ════════════════════════════════════════════════════════════════════

const app = express();

// Security headers
import helmet from "helmet";
app.use(helmet({ contentSecurityPolicy: false })); // CSP off — we serve audio

// CORS
const ALLOWED_ORIGINS = env.NODE_ENV === "production"
  ? [process.env.FRONTEND_URL || ""].filter(Boolean)
  : ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"];
app.use((_req, res, next) => {
  const origin = _req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

// Rate limiting
import rateLimit from "express-rate-limit";
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: env.NODE_ENV === "production" ? 60 : 1000,
  message: { error: "Too many requests" },
});
app.use("/api/", apiLimiter);

// Parse JSON for all routes except webhook (needs raw body)
app.use((req, res, next) => {
  if (req.path === "/livekit/webhook") {
    express.raw({ type: "application/webhook+json" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true }));

// ── API Routes ──────────────────────────────────────────────────────

// List captures — scoped to authenticated user
app.get("/api/captures", requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbCaptures = await dbq.listCapturesByUser(req.userId!);
    const merged = dbCaptures.map((row) => activeCaptures.get(row.id) ?? row);
    const inMemoryOnly = Array.from(activeCaptures.values()).filter(
      (c) => !dbCaptures.find((r) => r.id === c.id) && c.userId === req.userId
    );
    res.json([...merged, ...inMemoryOnly]);
  } catch {
    res.status(500).json({ error: "Failed to list captures" });
  }
});

// Get capture — always read from DB for completed/ended captures (has recording URLs)
// Use in-memory cache only for active calls (faster status updates)
app.get("/api/captures/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const capture = activeCaptures.get(id) ?? (await dbq.getCapture(id));
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }
  if (capture.userId !== req.userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(capture);
});

// Create capture — phoneA auto-filled from session, phoneB supplied by user
app.post("/api/captures", requireAuth, async (req: AuthRequest, res) => {
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

// Start capture — create room, start egress, dial both phones
app.post("/api/captures/:id/start", requireAuth, async (req: AuthRequest, res) => {
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
    // Create 3 rooms: 2 consent (isolated per-caller) + 1 main (recording)
    await Promise.all([
      roomService.createRoom({ name: consentRoomA, emptyTimeout: 120, maxParticipants: 4 }),
      roomService.createRoom({ name: consentRoomB, emptyTimeout: 120, maxParticipants: 4 }),
      roomService.createRoom({ name: capture.roomName!, emptyTimeout: 300, maxParticipants: 10 }),
    ]);
    logger.info(`[CAPTURE] Rooms created: ${consentRoomA}, ${consentRoomB}, ${capture.roomName}`);

    // Dispatch consent agents to each consent room
    await Promise.all([
      agentDispatch.createDispatch(consentRoomA, "consent-agent"),
      agentDispatch.createDispatch(consentRoomB, "consent-agent"),
    ]);
    logger.info(`[CAPTURE] Consent agents dispatched`);

    await dbq.updateCapture(capture.id, { status: "calling" });
  } catch (err: any) {
    capture.status = "created";
    logger.error("[CAPTURE] Setup failed:", err.message);
    // Cleanup any rooms that were created
    roomService.deleteRoom(consentRoomA).catch(() => {});
    roomService.deleteRoom(consentRoomB).catch(() => {});
    roomService.deleteRoom(capture.roomName!).catch(() => {});
    res.status(500).json({ error: err.message });
    return;
  }

  res.json({ status: "calling", roomName: capture.roomName });

  // Background: dial both phones IN PARALLEL into their consent rooms
  // Total max wait: 30s for ringing + 35s for consent = ~65s per caller
  // If either side fails at any point, abort everything immediately
  // Hard deadline: entire background flow must complete within 90s
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
      // Dial both phones simultaneously — race with a 30s ring timeout
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

      // Poll consent from both rooms in parallel
      const [consentA, consentB] = await Promise.all([
        pollConsentMetadata(consentRoomA),
        pollConsentMetadata(consentRoomB),
      ]);

      if (!consentA || !consentB) {
        logger.info({ consentA, consentB, captureId: capture.id }, "[CAPTURE] Consent denied");
        throw new Error("Consent denied");
      }

      logger.info(`[CAPTURE] Both consented — moving to ${capture.roomName}`);

      // Move both callers to main room in parallel
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

      // Cleanup consent rooms
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

/** Poll a room's metadata for consent result */
async function pollConsentMetadata(roomName: string, timeoutMs = 50_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let consecutiveErrors = 0;
  while (Date.now() < deadline) {
    try {
      const rooms = await roomService.listRooms([roomName]);
      consecutiveErrors = 0;
      if (rooms.length === 0) return false; // room deleted — caller hung up
      const meta = rooms[0]?.metadata;
      if (meta) {
        try {
          const parsed = JSON.parse(meta);
          if (parsed.consent === true) return true;
          if (parsed.consent === false) return false;
        } catch (parseErr: any) {
          logger.error({ err: parseErr.message, roomName }, "[CONSENT-POLL] Malformed metadata");
          return false;
        }
      }
    } catch (err: any) {
      consecutiveErrors++;
      logger.warn({ err: err.message, roomName, consecutiveErrors }, "[CONSENT-POLL] listRooms failed");
      if (consecutiveErrors >= 5) {
        logger.error({ roomName }, "[CONSENT-POLL] Too many failures, aborting");
        return false;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  logger.warn({ roomName, timeoutMs }, "[CONSENT-POLL] Timed out");
  return false;
}

// End capture — close room (egress auto-stops, uploads to S3)
app.post("/api/captures/:id/end", requireAuth, async (req: AuthRequest, res) => {
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
    capture.durationSeconds = capture.startedAt
      ? Math.round((Date.now() - new Date(capture.startedAt).getTime()) / 1000)
      : 0;

    if (wasActive) captureActiveGauge.dec();
    if (capture.durationSeconds) callDurationHistogram.observe(capture.durationSeconds);

    dbq.updateCapture(capture.id, {
      status: "ended",
      endedAt: new Date(capture.endedAt),
      durationSeconds: capture.durationSeconds,
    });

    // Recording will arrive via webhook when LiveKit finishes uploading to S3
    res.json({ status: "ended", durationSeconds: capture.durationSeconds });
  } catch (err: any) {
    logger.error("[CAPTURE] End failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── LiveKit Webhook — recording completion ──────────────────────────

app.post("/livekit/webhook", async (req, res) => {
  const webhookStart = Date.now();
  let body: string;
  let authHeader: string;
  let event: any;
  try {
    body = req.body.toString();
    authHeader = req.get("Authorization") || "";
    event = await webhookReceiver.receive(body, authHeader);
  } catch (err: any) {
    logger.error("[WEBHOOK] Signature verification failed:", err.message);
    res.sendStatus(401);
    return;
  }

  // Respond immediately — LiveKit retries if we don't ACK within ~5s
  res.sendStatus(200);

  try {
    logger.info(`[WEBHOOK] ${event.event}`);

    // ── Track which SIP callers are in each room ──────────────────────
    // LiveKit's numParticipants in webhooks is unreliable (excludes joining/leaving participant)
    // So we track SIP participants ourselves

    if (event.event === "participant_joined" && event.room && event.participant) {
      const roomName = event.room.name;
      const identity = event.participant.identity;

      // Only track SIP callers in the MAIN capture room (not consent rooms)
      if ((identity === "caller_a" || identity === "caller_b") && roomName.startsWith("capture-")) {
        const capture = Array.from(activeCaptures.values()).find((c) => c.roomName === roomName);
        if (capture) {
          if (!capture._joinedCallers) capture._joinedCallers = new Set();
          capture._joinedCallers.add(identity);
          const joined = capture._joinedCallers;
          logger.info(`[WEBHOOK] ${identity} joined ${roomName}. Callers in room: ${[...joined].join(", ")}`);

          // Both callers in main room — consent already verified, start recording
          if (joined.size >= 2 && !capture.egressId && capture.status !== "ended") {
            capture.egressId = "PENDING";
            try {
              // Mixed recording (both callers combined)
              const mixedOutput = createS3FileOutput(capture.id);
              const mixedEgress = await egressClient.startRoomCompositeEgress(
                roomName,
                { file: mixedOutput },
                { audioOnly: true },
              );
              capture.egressId = mixedEgress.egressId;
              dbq.updateCapture(capture.id, { egressId: capture.egressId });
              logger.info(`[WEBHOOK] Mixed egress started: ${mixedEgress.egressId}`);

              // Per-speaker recordings (caller_a and caller_b separately)
              for (const callerId of ["caller_a", "caller_b"]) {
                try {
                  const speakerOutput = new EncodedFileOutput({
                    fileType: EncodedFileType.MP4,
                    filepath: `recordings/${capture.id}-${callerId}.mp4`,
                    output: {
                      case: "s3",
                      value: new S3Upload({
                        accessKey: S3_ACCESS_KEY!,
                        secret: S3_SECRET_KEY!,
                        bucket: S3_BUCKET!,
                        region: S3_REGION || "auto",
                        endpoint: S3_ENDPOINT || "",
                        forcePathStyle: true,
                      }),
                    },
                  });
                  await egressClient.startParticipantEgress(
                    roomName,
                    callerId,
                    { file: speakerOutput },
                  );
                  egressSuccessTotal.inc({ type: callerId });
                  logger.info(`[WEBHOOK] ${callerId} egress started`);
                } catch (err: any) {
                  egressFailureTotal.inc();
                  logger.error(`[WEBHOOK] ${callerId} egress failed:`, err.message);
                }
              }
            } catch (err: any) {
              capture.egressId = undefined; // reset so retry is possible
              egressFailureTotal.inc();
              logger.error(`[WEBHOOK] Failed to start egress:`, err.message);
            }
          }
        }
      }
    }

    // When a SIP caller leaves
    if (event.event === "participant_left" && event.room && event.participant) {
      const roomName = event.room.name;
      const identity = event.participant.identity;

      if ((identity === "caller_a" || identity === "caller_b") && roomName.startsWith("capture-")) {
        const capture = Array.from(activeCaptures.values()).find((c) => c.roomName === roomName);
        if (capture) {
          capture._joinedCallers?.delete(identity);
          const remaining = capture._joinedCallers?.size ?? 0;
          logger.info(`[WEBHOOK] ${identity} left ${roomName}. Callers remaining: ${remaining}`);

          // Only end when ALL SIP callers have left (not when one hangs up)
          if (remaining === 0 && capture.status === "active") {
            captureActiveGauge.dec();
            capture.status = "ended";
            capture.endedAt = new Date().toISOString();
            capture.durationSeconds = capture.startedAt
              ? Math.round((Date.now() - new Date(capture.startedAt).getTime()) / 1000)
              : 0;
            dbq.updateCapture(capture.id, {
              status: "ended",
              endedAt: new Date(capture.endedAt),
              durationSeconds: capture.durationSeconds,
            });
            logger.info(`[WEBHOOK] Capture ${capture.id} ended (all callers left)`);

            // Delete the room to trigger egress finalization
            roomService.deleteRoom(roomName).catch(() => {});
          }
        }
      }
    }

    // Use room_finished as a fallback to mark capture as ended
    if (event.event === "room_finished" && event.room) {
      const roomName = event.room.name;
      const capture = Array.from(activeCaptures.values()).find((c) => c.roomName === roomName);
      if (capture && capture.status === "active") {
        captureActiveGauge.dec();
        capture.status = "ended";
        capture.endedAt = new Date().toISOString();
        capture.durationSeconds = capture.startedAt
          ? Math.round((Date.now() - new Date(capture.startedAt).getTime()) / 1000)
          : 0;
        await dbq.updateCapture(capture.id, {
          status: "ended",
          endedAt: new Date(capture.endedAt),
          durationSeconds: capture.durationSeconds,
        }).catch((e) => logger.error("[DB] room_finished update failed:", e.message));
        logger.info(`[WEBHOOK] Capture ${capture.id} ended (room finished)`);
      }
    }

    // When any egress finishes uploading to S3
    if (event.event === "egress_ended" && event.egressInfo) {
      const egressId = event.egressInfo.egressId;
      const roomName = event.egressInfo.roomName;

      // Get file path from results — LiveKit returns relative S3 path, not full URL
      const fileResults = event.egressInfo.fileResults ?? [];
      const rawPath = fileResults[0]?.location || fileResults[0]?.filename
        || (event.egressInfo as any).trackResults?.[0]?.location
        || (event.egressInfo as any).trackResults?.[0]?.filename;

      // Build full R2 URL: https://ENDPOINT/BUCKET/path
      const fileUrl = rawPath && !rawPath.startsWith("http")
        ? `${S3_ENDPOINT}/${S3_BUCKET}/${rawPath}`
        : rawPath;

      logger.info(`[WEBHOOK] Egress complete: ${egressId}, room: ${roomName}, file: ${fileUrl}`);

      // Find capture — by egressId (room composite) or by roomName (track egress)
      let row = await dbq.findCaptureByEgressId(egressId);
      if (!row && roomName) {
        // Track egresses don't have the egressId in our DB — find by room name
        row = await dbq.findCaptureByRoomName(roomName) ?? undefined;
      }

      if (row && fileUrl) {
        // Determine if this is the mixed recording or a per-speaker track
        const filepath = fileUrl.toLowerCase();
        const isMixed = filepath.includes("-mixed");
        const isCallerA = filepath.includes("-caller_a");
        const isCallerB = filepath.includes("-caller_b");

        if (isMixed) {
          // Download mixed recording locally
          const localPath = await downloadRecording(fileUrl, `${row.id}-mixed.ogg`).catch((err) => {
            logger.error("[WEBHOOK] Download failed:", err.message);
            return null;
          });
          await dbq.updateCapture(row.id, { recordingUrl: fileUrl, localRecordingPath: localPath });
          logger.info(`[WEBHOOK] Mixed recording saved for ${row.id}`);
        } else if (isCallerA) {
          await dbq.updateCapture(row.id, { recordingUrlA: fileUrl });
          logger.info(`[WEBHOOK] Caller A recording saved for ${row.id}`);
        } else if (isCallerB) {
          await dbq.updateCapture(row.id, { recordingUrlB: fileUrl });
          logger.info(`[WEBHOOK] Caller B recording saved for ${row.id}`);
        } else {
          // Unknown track — save as mixed
          const localPath = await downloadRecording(fileUrl, `${row.id}-mixed.ogg`).catch(() => null);
          await dbq.updateCapture(row.id, { recordingUrl: fileUrl, localRecordingPath: localPath });
          logger.info(`[WEBHOOK] Recording saved for ${row.id}`);
        }

        // Mark as completed when any recording is ready
        // (mixed is preferred, but per-speaker tracks also count)
        const cached = activeCaptures.get(row.id);
        if (cached && cached.status !== "completed") {
          cached.status = "completed";
          if (isMixed) cached.recordingUrl = fileUrl;
        }

        // Check DB — if we have at least one recording URL, mark completed
        const currentRow = await dbq.getCapture(row.id);
        if (currentRow && currentRow.status !== "completed") {
          const hasAnyRecording = currentRow.recordingUrl || currentRow.recordingUrlA || currentRow.recordingUrlB;
          if (hasAnyRecording) {
            // Compute duration if not already set (can be missed when call ends via webhook)
            const updates: Record<string, any> = { status: "completed" };
            if (!currentRow.durationSeconds && currentRow.startedAt) {
              const endTime = currentRow.endedAt ? new Date(currentRow.endedAt).getTime() : Date.now();
              updates.durationSeconds = Math.round((endTime - new Date(currentRow.startedAt).getTime()) / 1000);
              updates.endedAt = currentRow.endedAt ?? new Date();
            }
            await dbq.updateCapture(row.id, updates);
            // Clean up in-memory cache after a delay (let any in-flight webhooks finish)
            setTimeout(() => activeCaptures.delete(row.id), 10000);
            logger.info(`[WEBHOOK] Capture ${row.id} completed (duration: ${updates.durationSeconds ?? 'n/a'}s)`);
          }
        }
      }
    }
  } catch (err: any) {
    logger.error("[WEBHOOK] Error:", err.message);
  } finally {
    webhookDurationHistogram.observe({ event: "webhook" }, Date.now() - webhookStart);
  }
});

// ── Proxy R2 recordings ──────────────────────────────────────────────

app.get("/api/r2/:captureId/:filename", requireAuth, async (req: AuthRequest, res) => {
  const { captureId, filename } = req.params as { captureId: string; filename: string };
  const capture = await dbq.getCapture(captureId);
  if (!capture || capture.userId !== req.userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const s3Key = `recordings/${filename}`;
  const localPath = getRecordingPath(filename);

  // Serve from local cache if already downloaded
  if (recordingExists(filename)) {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(localPath);
    return;
  }

  // Download from R2 using execFile (safe, no shell injection)
  const { execFile } = require("child_process");
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: S3_ACCESS_KEY,
    AWS_SECRET_ACCESS_KEY: S3_SECRET_KEY,
  };

  execFile(
    "aws",
    ["s3", "cp", `s3://${S3_BUCKET}/${s3Key}`, localPath, "--endpoint-url", S3_ENDPOINT!],
    { env },
    (err: any) => {
      if (err) {
        logger.error("[R2] Download failed:", err.message);
        res.status(404).json({ error: "Recording not found in R2" });
        return;
      }
      logger.info(`[R2] Downloaded ${filename}`);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.sendFile(localPath);
    },
  );
});

// ── Serve local recordings ──────────────────────────────────────────

app.get("/api/recordings/:filename", requireAuth, async (req: AuthRequest, res) => {
  const { filename } = req.params as { filename: string };
  // Validate filename matches expected pattern
  const match = filename.match(/^([a-f0-9]+)-(mixed|caller_a|caller_b)\.[a-z0-9]+$/);
  if (!match) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const captureId = match[1];
  const capture = await dbq.getCapture(captureId);
  if (!capture || capture.userId !== req.userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!recordingExists(filename)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(getRecordingPath(filename));
});

// ── Prometheus metrics ───────────────────────────────────────────────

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});

// ── Health checks ────────────────────────────────────────────────────

// Liveness — is the process alive?
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: Math.round(process.uptime()), activeCaptures: activeCaptures.size });
});

// Readiness — can it serve traffic? (checks DB connectivity)
app.get("/ready", async (_req, res) => {
  try {
    await dbq.ping();
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not ready", reason: "database unreachable" });
  }
});

// ════════════════════════════════════════════════════════════════════
// Start + Graceful Shutdown
// ════════════════════════════════════════════════════════════════════

const server = app.listen(Number(PORT), () => {
  logger.info({ port: PORT }, "Voice Capture Platform started");
});

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down gracefully...");
  server.close(async () => {
    await shutdownTelemetry();
    logger.info("HTTP server closed");
    process.exit(0);
  });
  // Force exit after 30s if graceful shutdown fails
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 30_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
