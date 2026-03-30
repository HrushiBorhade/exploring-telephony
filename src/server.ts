import "dotenv/config";
import express from "express";
import crypto from "crypto";
import {
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
  WebhookReceiver,
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
    fileType: EncodedFileType.OGG,
    filepath: `recordings/${captureId}-mixed.ogg`,
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
    // 1. Create LiveKit room
    await roomService.createRoom({ name: capture.roomName!, emptyTimeout: 300, maxParticipants: 4 });
    console.log(`[CAPTURE] Room created: ${capture.roomName}`);

    // 2. Start room composite egress (audio-only → S3)
    const fileOutput = createS3FileOutput(capture.id);
    const egressInfo = await egressClient.startRoomCompositeEgress(
      capture.roomName!,
      { file: fileOutput },
      { audioOnly: true },
    );
    capture.egressId = egressInfo.egressId;
    console.log(`[CAPTURE] Egress started: ${egressInfo.egressId}`);

    // 3. Dial Phone A
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

    if (event.event === "egress_ended" && event.egressInfo) {
      const egressId = event.egressInfo.egressId;
      const fileResults = event.egressInfo.fileResults ?? [];
      const fileUrl = fileResults[0]?.location || fileResults[0]?.filename;

      console.log(`[WEBHOOK] Egress complete: ${egressId}, file: ${fileUrl}`);

      // Find capture by egressId
      const row = await dbq.findCaptureByEgressId(egressId);
      if (row && fileUrl) {
        // Download from S3 to local storage
        const localPath = await downloadRecording(fileUrl, `${row.id}-mixed.ogg`).catch((err) => {
          console.error("[WEBHOOK] Download failed:", err.message);
          return null;
        });

        await dbq.updateCapture(row.id, {
          status: "completed",
          recordingUrl: fileUrl,
          localRecordingPath: localPath,
        });

        // Update in-memory cache
        const cached = activeCaptures.get(row.id);
        if (cached) {
          cached.status = "completed";
          cached.recordingUrl = fileUrl;
          cached.localRecordingPath = localPath ?? undefined;
        }

        console.log(`[WEBHOOK] Capture ${row.id} completed. Recording: ${fileUrl}`);
      }
    }
  } catch (err: any) {
    console.error("[WEBHOOK] Error:", err.message);
  }

  res.sendStatus(200);
});

// ── Serve local recordings ──────────────────────────────────────────

app.get("/api/recordings/:filename", (req, res) => {
  const { filename } = req.params;
  if (!recordingExists(filename)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.setHeader("Content-Type", "audio/ogg");
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
