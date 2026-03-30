import "dotenv/config";
import express from "express";
import crypto from "crypto";
import {
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
  WebhookReceiver,
  AutoTrackEgress,
  DirectFileOutput,
  RoomEgress,
} from "livekit-server-sdk";
import { roomService, sipClient, egressClient } from "./livekit";
import * as dbq from "./db/queries";
import { downloadRecording, getRecordingPath, recordingExists } from "./audio";
import type { Capture } from "./types";

// ════════════════════════════════════════════════════════════════════
// Config
// ════════════════════════════════════════════════════════════════════

const {
  LIVEKIT_SIP_TRUNK_ID,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  S3_ACCESS_KEY,
  S3_SECRET_KEY,
  S3_BUCKET,
  S3_REGION,
  S3_ENDPOINT,
  PORT = "3001",
} = process.env;

const missing = [
  !LIVEKIT_SIP_TRUNK_ID && "LIVEKIT_SIP_TRUNK_ID",
  !S3_ACCESS_KEY && "S3_ACCESS_KEY",
  !S3_SECRET_KEY && "S3_SECRET_KEY",
  !S3_BUCKET && "S3_BUCKET",
].filter(Boolean);

if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

// Catch unhandled promise rejections
process.on("unhandledRejection", (reason: any) => {
  console.error("[UNHANDLED]", reason?.message ?? reason);
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

// CORS
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  next();
});

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

// List captures
app.get("/api/captures", async (_req, res) => {
  const rows = await dbq.listCaptures();
  res.json(rows);
});

// Get capture
app.get("/api/captures/:id", async (req, res) => {
  const cached = activeCaptures.get(req.params.id);
  if (cached) { res.json(cached); return; }

  const row = await dbq.getCapture(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// Create capture
app.post("/api/captures", async (req, res) => {
  const { name, phoneA, phoneB, language } = req.body;
  if (!phoneA || !phoneB) {
    res.status(400).json({ error: "Need phoneA and phoneB" });
    return;
  }

  const id = crypto.randomBytes(6).toString("hex");
  const roomName = `capture-${id}`;
  const capture: Capture = {
    id,
    name: name || "Untitled",
    phoneA,
    phoneB,
    language: language || "en",
    status: "created",
    roomName,
    createdAt: new Date().toISOString(),
  };

  activeCaptures.set(id, capture);
  await dbq.createCapture({
    id,
    name: capture.name,
    phoneA,
    phoneB,
    language: capture.language,
    status: "created",
    roomName,
  });

  console.log(`[CAPTURE] Created: ${id}`);
  res.json(capture);
});

// Start capture — create room, start egress, dial both phones
app.post("/api/captures/:id/start", async (req, res) => {
  const capture = activeCaptures.get(req.params.id);
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }
  if (capture.status !== "created") {
    res.status(400).json({ error: `Status is ${capture.status}` });
    return;
  }

  capture.status = "calling";
  capture.startedAt = new Date().toISOString();

  try {
    // 1. Create LiveKit room with auto track egress
    // This automatically records each participant's audio as a SEPARATE file
    // → recordings/captureId-caller_a-timestamp.ogg (Phone A only)
    // → recordings/captureId-caller_b-timestamp.ogg (Phone B only)
    const s3Config = new S3Upload({
      accessKey: S3_ACCESS_KEY!,
      secret: S3_SECRET_KEY!,
      bucket: S3_BUCKET!,
      region: S3_REGION || "auto",
      endpoint: S3_ENDPOINT || "",
      forcePathStyle: true,
    });

    await roomService.createRoom({
      name: capture.roomName!,
      emptyTimeout: 300,
      maxParticipants: 4,
      egress: new RoomEgress({
        tracks: new AutoTrackEgress({
          filepath: `recordings/${capture.id}-{publisher_identity}-{time}`,
          output: { case: "s3", value: s3Config },
        }),
      }),
    });
    console.log(`[CAPTURE] Room created with per-speaker auto-egress: ${capture.roomName}`);

    // NOTE: Mixed recording egress starts in the webhook when BOTH callers join
    // This avoids recording silence/ringing before the conversation starts

    // 2. Dial Phone A
    await sipClient.createSipParticipant(
      LIVEKIT_SIP_TRUNK_ID!,
      capture.phoneA,
      capture.roomName!,
      {
        participantIdentity: "caller_a",
        participantName: "Phone A",
        krispEnabled: true,
      },
    );
    console.log(`[CAPTURE] Dialing Phone A: ${capture.phoneA}`);

    // 4. Stagger + Dial Phone B
    await new Promise((r) => setTimeout(r, 2000));

    await sipClient.createSipParticipant(
      LIVEKIT_SIP_TRUNK_ID!,
      capture.phoneB,
      capture.roomName!,
      {
        participantIdentity: "caller_b",
        participantName: "Phone B",
        krispEnabled: true,
      },
    );
    console.log(`[CAPTURE] Dialing Phone B: ${capture.phoneB}`);

    capture.status = "active";
    dbq.updateCapture(capture.id, {
      status: "active",
      startedAt: new Date(capture.startedAt),
      egressId: capture.egressId,
    });

    res.json({ roomName: capture.roomName, egressId: capture.egressId });
  } catch (err: any) {
    capture.status = "created";
    capture.startedAt = undefined;
    console.error("[CAPTURE] Start failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// End capture — close room (egress auto-stops, uploads to S3)
app.post("/api/captures/:id/end", async (req, res) => {
  const capture = activeCaptures.get(req.params.id);
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }

  try {
    await roomService.deleteRoom(capture.roomName!);
    console.log(`[CAPTURE] Room deleted: ${capture.roomName}`);

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

    // Recording will arrive via webhook when LiveKit finishes uploading to S3
    res.json({ status: "ended", durationSeconds: capture.durationSeconds });
  } catch (err: any) {
    console.error("[CAPTURE] End failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── LiveKit Webhook — recording completion ──────────────────────────

app.post("/livekit/webhook", async (req, res) => {
  try {
    const body = req.body.toString();
    const authHeader = req.get("Authorization") || "";
    const event = await webhookReceiver.receive(body, authHeader);

    console.log(`[WEBHOOK] ${event.event}`);

    // When second SIP participant joins → start mixed recording
    if (event.event === "participant_joined" && event.room && event.participant) {
      const roomName = event.room.name;
      const numParticipants = event.room.numParticipants;
      const identity = event.participant.identity;
      console.log(`[WEBHOOK] ${identity} joined ${roomName}. ${numParticipants} in room.`);

      // Start mixed egress when both callers are in (numParticipants >= 2)
      // Only start if we haven't started it yet (no egressId)
      if (numParticipants >= 2) {
        const capture = Array.from(activeCaptures.values()).find((c) => c.roomName === roomName);
        if (capture && !capture.egressId) {
          try {
            const fileOutput = createS3FileOutput(capture.id);
            const egressInfo = await egressClient.startRoomCompositeEgress(
              roomName,
              { file: fileOutput },
              { audioOnly: true },
            );
            capture.egressId = egressInfo.egressId;
            dbq.updateCapture(capture.id, { egressId: capture.egressId });
            console.log(`[WEBHOOK] Mixed egress started: ${egressInfo.egressId} (both callers in room)`);
          } catch (err: any) {
            console.error(`[WEBHOOK] Failed to start mixed egress:`, err.message);
          }
        }
      }
    }

    // When both participants leave, close the room + end capture
    if (event.event === "participant_left" && event.room && event.participant) {
      const roomName = event.room.name;
      const remaining = event.room.numParticipants;
      console.log(`[WEBHOOK] ${event.participant.identity} left ${roomName}. ${remaining} remaining.`);

      // If room is empty (both callers hung up), clean up
      if (remaining === 0) {
        // Find capture by room name
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
          console.log(`[WEBHOOK] Capture ${capture.id} ended (both callers hung up)`);

          // Delete the room to trigger egress finalization
          roomService.deleteRoom(roomName).catch(() => {});
        }
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

      console.log(`[WEBHOOK] Egress complete: ${egressId}, room: ${roomName}, file: ${fileUrl}`);

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
            console.error("[WEBHOOK] Download failed:", err.message);
            return null;
          });
          await dbq.updateCapture(row.id, { recordingUrl: fileUrl, localRecordingPath: localPath });
          console.log(`[WEBHOOK] Mixed recording saved for ${row.id}`);
        } else if (isCallerA) {
          await dbq.updateCapture(row.id, { recordingUrlA: fileUrl });
          console.log(`[WEBHOOK] Caller A recording saved for ${row.id}`);
        } else if (isCallerB) {
          await dbq.updateCapture(row.id, { recordingUrlB: fileUrl });
          console.log(`[WEBHOOK] Caller B recording saved for ${row.id}`);
        } else {
          // Unknown track — save as mixed
          const localPath = await downloadRecording(fileUrl, `${row.id}-mixed.ogg`).catch(() => null);
          await dbq.updateCapture(row.id, { recordingUrl: fileUrl, localRecordingPath: localPath });
          console.log(`[WEBHOOK] Recording saved for ${row.id}`);
        }

        // Mark as completed when the mixed recording is ready
        if (isMixed) {
          await dbq.updateCapture(row.id, { status: "completed" });
          const cached = activeCaptures.get(row.id);
          if (cached) {
            cached.status = "completed";
            cached.recordingUrl = fileUrl;
          }
          console.log(`[WEBHOOK] Capture ${row.id} completed`);
        }
      }
    }
  } catch (err: any) {
    console.error("[WEBHOOK] Error:", err.message);
  }

  res.sendStatus(200);
});

// ── Proxy R2 recordings ──────────────────────────────────────────────

app.get("/api/r2/:captureId/:filename", async (req, res) => {
  const s3Key = `recordings/${req.params.filename}`;
  const localPath = getRecordingPath(req.params.filename);

  // Serve from local cache if already downloaded
  if (recordingExists(req.params.filename)) {
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
        console.error("[R2] Download failed:", err.message);
        res.status(404).json({ error: "Recording not found in R2" });
        return;
      }
      console.log(`[R2] Downloaded ${req.params.filename}`);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.sendFile(localPath);
    },
  );
});

// ── Serve local recordings ──────────────────────────────────────────

app.get("/api/recordings/:filename", (req, res) => {
  const { filename } = req.params;
  if (!recordingExists(filename)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(getRecordingPath(filename));
});

// ── Health ───────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", activeCaptures: activeCaptures.size });
});

// ════════════════════════════════════════════════════════════════════
// Start
// ════════════════════════════════════════════════════════════════════

app.listen(Number(PORT), () => {
  console.log(`
  ╔════════════════════════════════════════════════╗
  ║  Voice Capture Platform (LiveKit + Telnyx)     ║
  ║  http://localhost:${PORT}                        ║
  ╚════════════════════════════════════════════════╝
  `);
});
