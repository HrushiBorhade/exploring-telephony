/**
 * Telephony Agent — Combined entrypoint for LiveKit Cloud deployment.
 *
 * Routes to consent or announce logic based on dispatch metadata.
 * This allows both agent roles to run in a single deployment (free tier = 1 deployment).
 *
 * Dispatch from API:
 *   agentDispatch.createDispatch(room, "telephony-agent", { metadata: '{"type":"consent"}' })
 *   agentDispatch.createDispatch(room, "telephony-agent", { metadata: '{"type":"announce"}' })
 *
 * Local dev (individual agents still work):
 *   tsx src/consent-agent.ts dev
 *   tsx src/announce-agent.ts dev
 */
import "dotenv/config";
import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  inference,
  voice,
} from "@livekit/agents";
import { RoomServiceClient } from "livekit-server-sdk";
import fs from "node:fs";
import path from "node:path";

// @livekit/rtc-node is a transitive dep of @livekit/agents — use runtime require
// to avoid TS resolution issues without adding it as a direct dependency
type AudioFrameInstance = { data: Int16Array; sampleRate: number; channels: number; samplesPerChannel: number };
const { AudioFrame } = require("@livekit/rtc-node") as {
  AudioFrame: new (data: Int16Array, sampleRate: number, channels: number, samplesPerChannel: number) => AudioFrameInstance;
};

// ── Constants ──
const CONSENT_AUDIO = path.resolve(__dirname, "../assets/consent_48k.wav");
const ANNOUNCE_AUDIO = path.resolve(__dirname, "../assets/announce_48k.wav");
const SAMPLE_RATE = 48_000;
const NUM_CHANNELS = 1;
const SAMPLES_PER_FRAME = SAMPLE_RATE / 10; // 100ms chunks = 4800 samples
const DTMF_TIMEOUT_MS = 60_000;
const CALLER_WAIT_MS = 60_000;
const PLEASE_WAIT_INTERVAL_MS = 5_000;
const WAIT_FOR_CALLERS_MS = 30_000;

// ── Shared: WAV → AudioFrame reader ──

function wavToAudioFrames(filePath: string): ReadableStream<any> {
  const buf = fs.readFileSync(filePath);

  const riff = buf.toString("ascii", 0, 4);
  const wave = buf.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error(`Not a WAV file: ${filePath}`);
  }

  let dataOffset = 12;
  while (dataOffset < buf.length - 8) {
    const chunkId = buf.toString("ascii", dataOffset, dataOffset + 4);
    const chunkSize = buf.readUInt32LE(dataOffset + 4);
    if (chunkId === "data") {
      dataOffset += 8;
      break;
    }
    dataOffset += 8 + chunkSize;
  }

  const pcmBytes = buf.subarray(dataOffset);
  const samples = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2);
  const totalSamples = samples.length;

  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < totalSamples; offset += SAMPLES_PER_FRAME) {
        const end = Math.min(offset + SAMPLES_PER_FRAME, totalSamples);
        const chunk = samples.slice(offset, end);
        controller.enqueue(new AudioFrame(chunk, SAMPLE_RATE, NUM_CHANNELS, chunk.length));
      }
      controller.close();
    },
  });
}

// ── Consent: set room metadata with retry ──

async function setMetadata(roomName: string, consent: boolean) {
  const rs = new RoomServiceClient(
    process.env.LIVEKIT_URL!.replace("wss://", "https://"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await rs.updateRoomMetadata(roomName, JSON.stringify({ consent }));
      return;
    } catch (err: any) {
      console.error(`[CONSENT] setMetadata attempt ${attempt}/3 failed: ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  console.error(`[CONSENT] CRITICAL: All metadata attempts failed for ${roomName}`);
}

// ── Consent logic (identical to consent-agent.ts) ──

async function runConsent(ctx: JobContext) {
  const room = ctx.room;
  let callerIdentity: string | null = null;
  let consented = false;
  let disconnected = false;

  // Track when the caller is moved out (moveParticipant triggers disconnect)
  (room as any).on("participantDisconnected", (participant: any) => {
    if (participant.identity === callerIdentity) {
      disconnected = true;
      console.log(`[CONSENT] ${callerIdentity} moved out of ${room.name}`);
    }
  });

  // DTMF listener — registered before connect
  (room as any).on("dtmfReceived", (_code: number, digit: string, participant: any) => {
    if (digit === "1" && (participant.identity === "caller_a" || participant.identity === "caller_b")) {
      callerIdentity = participant.identity;
      consented = true;
      console.log(`[CONSENT] ${callerIdentity} pressed 1`);
    }
  });

  await ctx.connect();

  // Initialize session with TTS for "please wait" announcements
  const session = new voice.AgentSession({
    aecWarmupDuration: 0,
    tts: new inference.TTS({ model: "cartesia/sonic-3" }),
  });
  await session.start({
    agent: new voice.Agent({ instructions: "Play consent." }),
    room,
  });
  console.log(`[CONSENT] Agent ready in ${room.name}`);

  // Wait for the SIP caller to join
  const callerDeadline = Date.now() + CALLER_WAIT_MS;
  while (Date.now() < callerDeadline) {
    for (const p of room.remoteParticipants.values()) {
      if (p.identity === "caller_a" || p.identity === "caller_b") {
        callerIdentity = p.identity;
      }
    }
    if (callerIdentity) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!callerIdentity) {
    console.log(`[CONSENT] No caller joined ${room.name}, exiting`);
    await setMetadata(room.name!, false);
    ctx.shutdown();
    return;
  }

  // Play consent immediately — direct PCM, no ffmpeg
  console.log(`[CONSENT] ${callerIdentity} joined — playing consent`);
  const handle = session.say(
    "This call is being recorded for quality and training purposes. Press 1 to consent.",
    { audio: wavToAudioFrames(CONSENT_AUDIO) },
  );
  await handle.waitForPlayout();

  // Wait for DTMF "1"
  const dtmfDeadline = Date.now() + DTMF_TIMEOUT_MS;
  while (Date.now() < dtmfDeadline && !consented) {
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`[CONSENT] ${room.name}: ${consented ? "GRANTED" : "DENIED"}`);
  await setMetadata(room.name!, consented);

  if (!consented) {
    ctx.shutdown();
    return;
  }

  // Consent granted — loop "please wait" until caller is moved to capture room
  console.log(`[CONSENT] ${room.name}: playing "please wait" loop`);
  while (!disconnected) {
    const waitHandle = session.say("Please wait while we connect the other party.", {
      allowInterruptions: true,
    });
    await waitHandle.waitForPlayout();
    // Brief pause between repetitions
    const pauseEnd = Date.now() + PLEASE_WAIT_INTERVAL_MS;
    while (Date.now() < pauseEnd && !disconnected) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`[CONSENT] ${room.name}: caller moved, shutting down`);
  ctx.shutdown();
}

// ── Announce logic (identical to announce-agent.ts) ──

async function runAnnounce(ctx: JobContext) {
  const room = ctx.room;
  await ctx.connect();

  const session = new voice.AgentSession({
    aecWarmupDuration: 0,
    tts: new inference.TTS({ model: "cartesia/sonic-3" }),
  });
  await session.start({
    agent: new voice.Agent({ instructions: "Announce recording." }),
    room,
  });

  // Wait until both callers are present
  const deadline = Date.now() + WAIT_FOR_CALLERS_MS;
  while (Date.now() < deadline) {
    const identities = new Set<string>();
    for (const p of room.remoteParticipants.values()) {
      if (p.identity === "caller_a" || p.identity === "caller_b") {
        identities.add(p.identity);
      }
    }
    if (identities.size >= 2) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // Play pre-recorded announcement — instant, no TTS generation delay
  const handle = session.say(
    "Both parties are now connected. This call is being recorded.",
    { allowInterruptions: false, audio: wavToAudioFrames(ANNOUNCE_AUDIO) },
  );
  await handle.waitForPlayout();

  console.log(`[ANNOUNCE] Played connection announcement in ${room.name}`);
  ctx.shutdown();
}

// ── Combined entrypoint — routes based on dispatch metadata ──

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const metadata = JSON.parse(ctx.job.metadata || '{"type":"consent"}');
    const type = metadata.type || "consent";

    console.log(`[AGENT] Job ${ctx.job.id} — type: ${type}, room: ${ctx.room.name}`);

    if (type === "announce") {
      await runAnnounce(ctx);
    } else {
      await runConsent(ctx);
    }
  },
});

cli.runApp(
  new WorkerOptions({
    agent: __filename,
    agentName: "telephony-agent",
  }),
);
