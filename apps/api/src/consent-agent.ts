/**
 * Consent Agent Worker
 *
 * Two modes based on room name:
 *   consent-* → Consent flow: play consent, collect DTMF, loop "please wait"
 *   capture-* → Greeting flow: play "both joined", set metadata, exit
 *
 * Run:  tsx src/consent-agent.ts dev
 */
import "dotenv/config";
import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
} from "@livekit/agents";
import { RoomServiceClient } from "livekit-server-sdk";
import fs from "node:fs";
import path from "node:path";

type AudioFrameInstance = { data: Int16Array; sampleRate: number; channels: number; samplesPerChannel: number };
const { AudioFrame } = require("@livekit/rtc-node") as {
  AudioFrame: new (data: Int16Array, sampleRate: number, channels: number, samplesPerChannel: number) => AudioFrameInstance;
};

const CONSENT_AUDIO = path.resolve(__dirname, "../assets/consent_48k.wav");
const WAIT_AUDIO = path.resolve(__dirname, "../assets/wait_48k.wav");
const GREETING_AUDIO = path.resolve(__dirname, "../assets/greeting_48k.wav");
const SAMPLE_RATE = 48_000;
const NUM_CHANNELS = 1;
const SAMPLES_PER_FRAME = SAMPLE_RATE / 10;
const DTMF_TIMEOUT_MS = 30_000;
const CALLER_WAIT_MS = 60_000;

function wavToAudioFrames(filePath: string): ReadableStream<any> {
  const buf = fs.readFileSync(filePath);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Not a WAV file: ${filePath}`);
  }
  let dataOffset = 12;
  while (dataOffset < buf.length - 8) {
    const chunkId = buf.toString("ascii", dataOffset, dataOffset + 4);
    const chunkSize = buf.readUInt32LE(dataOffset + 4);
    if (chunkId === "data") { dataOffset += 8; break; }
    dataOffset += 8 + chunkSize;
  }
  const pcmBytes = buf.subarray(dataOffset);
  const samples = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2);
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < samples.length; offset += SAMPLES_PER_FRAME) {
        const end = Math.min(offset + SAMPLES_PER_FRAME, samples.length);
        const chunk = samples.slice(offset, end);
        controller.enqueue(new AudioFrame(chunk, SAMPLE_RATE, NUM_CHANNELS, chunk.length));
      }
      controller.close();
    },
  });
}

function callerInRoom(room: any): boolean {
  for (const p of room.remoteParticipants.values()) {
    if (p.identity === "caller_a" || p.identity === "caller_b") return true;
  }
  return false;
}

// ── Consent mode: play consent, DTMF, loop "please wait" ──────────

async function runConsentFlow(ctx: JobContext) {
  const room = ctx.room;
  let callerIdentity: string | null = null;
  let consented = false;

  (room as any).on("dtmfReceived", (_code: number, digit: string, participant: any) => {
    if (digit === "1" && (participant.identity === "caller_a" || participant.identity === "caller_b")) {
      callerIdentity = participant.identity;
      consented = true;
      console.log(`[CONSENT] ${callerIdentity} pressed 1`);
    }
  });

  await ctx.connect();

  const session = new voice.AgentSession({ aecWarmupDuration: 0 });
  await session.start({ agent: new voice.Agent({ instructions: "Play consent." }), room });
  console.log(`[CONSENT] Agent ready in ${room.name}`);

  // Wait for caller
  const callerDeadline = Date.now() + CALLER_WAIT_MS;
  while (Date.now() < callerDeadline) {
    for (const p of room.remoteParticipants.values()) {
      if (p.identity === "caller_a" || p.identity === "caller_b") callerIdentity = p.identity;
    }
    if (callerIdentity) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!callerIdentity) {
    console.log(`[CONSENT] No caller joined ${room.name}, exiting`);
    await setMetadata(room.name!, "consent", false);
    ctx.shutdown();
    return;
  }

  // Play consent
  console.log(`[CONSENT] ${callerIdentity} joined — playing consent`);
  await session.say("consent", { audio: wavToAudioFrames(CONSENT_AUDIO) }).waitForPlayout();

  // Wait for DTMF "1"
  const dtmfDeadline = Date.now() + DTMF_TIMEOUT_MS;
  while (Date.now() < dtmfDeadline && !consented) {
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`[CONSENT] ${room.name}: ${consented ? "GRANTED" : "DENIED"}`);

  // Set metadata to signal server — THEN loop "please wait" (don't exit)
  await setMetadata(room.name!, "consent", consented);

  if (!consented) {
    ctx.shutdown();
    return;
  }

  // Loop "please wait" until caller is moved out (moveParticipant removes them)
  console.log(`[CONSENT] ${room.name}: looping "please wait"`);
  while (callerInRoom(room)) {
    try {
      await session.say("wait", { audio: wavToAudioFrames(WAIT_AUDIO) }).waitForPlayout();
      // Brief pause between loops so it doesn't sound frantic
      await new Promise((r) => setTimeout(r, 1000));
    } catch {
      // session.say fails when caller leaves — that's our exit signal
      break;
    }
  }

  console.log(`[CONSENT] ${room.name}: caller moved out, exiting`);
  ctx.shutdown();
}

// ── Greeting mode: play "both joined", set metadata, exit ──────────

async function runGreetingFlow(ctx: JobContext) {
  const room = ctx.room;

  await ctx.connect();

  const session = new voice.AgentSession({ aecWarmupDuration: 0 });
  await session.start({ agent: new voice.Agent({ instructions: "Play greeting." }), room });
  console.log(`[GREETING] Agent ready in ${room.name}`);

  // Brief wait for audio tracks to be established
  await new Promise((r) => setTimeout(r, 500));

  // Play greeting
  await session.say("greeting", { audio: wavToAudioFrames(GREETING_AUDIO) }).waitForPlayout();
  console.log(`[GREETING] Greeting played in ${room.name}`);

  // Signal server that greeting is done — egress can start
  await setMetadata(room.name!, "greeting", true);

  ctx.shutdown();
}

// ── Entry point: pick mode based on room name ──────────────────────

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const roomName = ctx.room.name ?? "";
    if (roomName.startsWith("capture-")) {
      await runGreetingFlow(ctx);
    } else {
      await runConsentFlow(ctx);
    }
  },
});

async function setMetadata(roomName: string, key: string, value: boolean) {
  const rs = new RoomServiceClient(
    process.env.LIVEKIT_URL!.replace("wss://", "https://"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await rs.updateRoomMetadata(roomName, JSON.stringify({ [key]: value }));
      return;
    } catch (err: any) {
      console.error(`[AGENT] setMetadata(${key}) attempt ${attempt}/3 failed: ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  console.error(`[AGENT] CRITICAL: All metadata attempts failed for ${roomName}`);
}

cli.runApp(
  new WorkerOptions({
    agent: __filename,
    agentName: "consent-agent",
  }),
);
