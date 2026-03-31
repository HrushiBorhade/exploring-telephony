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
} from "livekit-server-sdk";
import { roomService, sipClient, egressClient } from "./livekit";
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
  : ["http://localhost:3000", "http://localhost:3001"];
app.use((_req, res, next) => {
  const origin = _req.headers.origin || "";
  if (env.NODE_ENV !== "production" || ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*");
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
  if (capture.userId && capture.userId !== req.userId) {
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
  if (capture.userId && capture.userId !== req.userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (capture.status !== "created") {
    res.status(400).json({ error: `Status is ${capture.status}` });
    return;
  }

  capture.status = "calling";
  // startedAt is intentionally NOT set here — it marks when both callers answer,
  // so durationSeconds reflects actual connected time, not ringing time.

  try {
    // 1. Create room — egress starts via webhook only after both callers answer
    await roomService.createRoom({ name: capture.roomName!, emptyTimeout: 300, maxParticipants: 4 });
    logger.info(`[CAPTURE] Room created: ${capture.roomName}`);

    dbq.updateCapture(capture.id, { status: "calling" });
  } catch (err: any) {
    capture.status = "created";
    logger.error("[CAPTURE] Room creation failed:", err.message);
    res.status(500).json({ error: err.message });
    return;
  }

  // Return immediately — dialing is async. Status updates come via webhook.
  res.json({ status: "calling", roomName: capture.roomName });

  // 2. Dial both phones in background with waitUntilAnswered — participant_joined
  // only fires after the human picks up, so egress won't start on a dead ring.
  (async () => {
    try {
      await sipClient.createSipParticipant(
        LIVEKIT_SIP_TRUNK_ID!,
        capture.phoneA,
        capture.roomName!,
        {
          participantIdentity: "caller_a",
          participantName: "Phone A",
          krispEnabled: true,
          waitUntilAnswered: true,
        },
      );
      logger.info(`[CAPTURE] Phone A answered: ${capture.phoneA}`);

      // Small stagger so both legs don't hit egress start simultaneously
      await new Promise((r) => setTimeout(r, 500));

      await sipClient.createSipParticipant(
        LIVEKIT_SIP_TRUNK_ID!,
        capture.phoneB,
        capture.roomName!,
        {
          participantIdentity: "caller_b",
          participantName: "Phone B",
          krispEnabled: true,
          waitUntilAnswered: true,
        },
      );
      logger.info(`[CAPTURE] Phone B answered: ${capture.phoneB}`);

      // Both answered — start the clock now (excludes ringing time)
      capture.startedAt = new Date().toISOString();
      capture.status = "active";
      captureActiveGauge.inc();
      dbq.updateCapture(capture.id, {
        status: "active",
        startedAt: new Date(capture.startedAt),
      });
    } catch (err: any) {
      // One or both callers didn't answer — clean up
      logger.error("[CAPTURE] Dialing failed:", err.message);
      capture.status = "ended";
      capture.endedAt = new Date().toISOString();
      capture.durationSeconds = 0;
      dbq.updateCapture(capture.id, {
        status: "ended",
        endedAt: new Date(capture.endedAt),
        durationSeconds: 0,
      });
      roomService.deleteRoom(capture.roomName!).catch(() => {});
    }
  })();
});

// End capture — close room (egress auto-stops, uploads to S3)
app.post("/api/captures/:id/end", requireAuth, async (req: AuthRequest, res) => {
  const capture = activeCaptures.get(req.params.id as string);
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }
  if (capture.userId && capture.userId !== req.userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  try {
    await roomService.deleteRoom(capture.roomName!);
    logger.info(`[CAPTURE] Room deleted: ${capture.roomName}`);

    capture.status = "ended";
    capture.endedAt = new Date().toISOString();
    capture.durationSeconds = capture.startedAt
      ? Math.round((Date.now() - new Date(capture.startedAt).getTime()) / 1000)
      : 0;

    captureActiveGauge.dec();
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
  try {
    const body = req.body.toString();
    const authHeader = req.get("Authorization") || "";
    const event = await webhookReceiver.receive(body, authHeader);

    logger.info(`[WEBHOOK] ${event.event}`);

    // ── Track which SIP callers are in each room ──────────────────────
    // LiveKit's numParticipants in webhooks is unreliable (excludes joining/leaving participant)
    // So we track SIP participants ourselves

    if (event.event === "participant_joined" && event.room && event.participant) {
      const roomName = event.room.name;
      const identity = event.participant.identity;

      // Only track our SIP callers, not egress bots
      if (identity === "caller_a" || identity === "caller_b") {
        const capture = Array.from(activeCaptures.values()).find((c) => c.roomName === roomName);
        if (capture) {
          if (!capture._joinedCallers) capture._joinedCallers = new Set();
          capture._joinedCallers.add(identity);
          const joined = capture._joinedCallers;
          logger.info(`[WEBHOOK] ${identity} joined ${roomName}. Callers in room: ${[...joined].join(", ")}`);

          // Both callers joined — start all recordings NOW (no ringing silence)
          // Guard: set egressId to PENDING synchronously to prevent race condition
          // (two webhooks can fire nearly simultaneously)
          if (joined.size >= 2 && !capture.egressId) {
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

      if (identity === "caller_a" || identity === "caller_b") {
        const capture = Array.from(activeCaptures.values()).find((c) => c.roomName === roomName);
        if (capture) {
          capture._joinedCallers?.delete(identity);
          const remaining = capture._joinedCallers?.size ?? 0;
          logger.info(`[WEBHOOK] ${identity} left ${roomName}. Callers remaining: ${remaining}`);

          // Only end when ALL SIP callers have left (not when one hangs up)
          if (remaining === 0 && capture.status === "active") {
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
        const captures = await dbq.listCaptures();
        row = captures.find((c) => c.roomName === roomName) ?? undefined;
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
            await dbq.updateCapture(row.id, { status: "completed" });
            // Clean up in-memory cache after a delay (let any in-flight webhooks finish)
            setTimeout(() => activeCaptures.delete(row.id), 10000);
            logger.info(`[WEBHOOK] Capture ${row.id} completed`);
          }
        }
      }
    }
  } catch (err: any) {
    logger.error("[WEBHOOK] Error:", err.message);
  } finally {
    webhookDurationHistogram.observe({ event: "webhook" }, Date.now() - webhookStart);
  }

  res.sendStatus(200);
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
  // Extract captureId from filename pattern: "<captureId>-mixed.ogg" or "<captureId>-caller_a.ogg"
  const captureId = filename.replace(/-(mixed|caller_a|caller_b)\.[^.]+$/, "");
  if (captureId !== filename) {
    const capture = await dbq.getCapture(captureId);
    if (!capture || capture.userId !== req.userId) {
      res.status(404).json({ error: "Not found" });
      return;
    }
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
    await dbq.listCaptures(); // lightweight DB ping
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
