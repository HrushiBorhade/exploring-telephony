/**
 * Consent Agent Worker — Single Caller
 *
 * Each caller gets their own consent room with their own agent instance.
 * The agent waits for 1 SIP caller, plays consent, collects DTMF "1",
 * and sets room metadata. After consent, loops "please wait" until
 * the caller is moved to the capture room.
 *
 * Audio: reads raw PCM from WAV directly — no ffmpeg, no conversion.
 *
 * Run:  tsx src/consent-agent.ts dev
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

const CONSENT_AUDIO = path.resolve(__dirname, "../assets/consent_48k.wav");
const SAMPLE_RATE = 48_000;
const NUM_CHANNELS = 1;
const SAMPLES_PER_FRAME = SAMPLE_RATE / 10; // 100ms chunks = 4800 samples
const DTMF_TIMEOUT_MS = 30_000;
const CALLER_WAIT_MS = 60_000;
const PLEASE_WAIT_INTERVAL_MS = 5_000;

/**
 * Read a 16-bit PCM WAV file directly into AudioFrame chunks.
 * Zero ffmpeg. Zero conversion. Just memory copy.
 */
function wavToAudioFrames(filePath: string): ReadableStream<any> {
  const buf = fs.readFileSync(filePath);

  // Parse WAV header — validate format
  const riff = buf.toString("ascii", 0, 4);
  const wave = buf.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error(`Not a WAV file: ${filePath}`);
  }

  // Find "data" chunk (usually at byte 36, but be safe)
  let dataOffset = 12;
  while (dataOffset < buf.length - 8) {
    const chunkId = buf.toString("ascii", dataOffset, dataOffset + 4);
    const chunkSize = buf.readUInt32LE(dataOffset + 4);
    if (chunkId === "data") {
      dataOffset += 8; // skip "data" + size
      break;
    }
    dataOffset += 8 + chunkSize;
  }

  // Raw PCM data as Int16Array
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

export default defineAgent({
  entry: async (ctx: JobContext) => {
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
  },
});

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

cli.runApp(
  new WorkerOptions({
    agent: __filename,
    agentName: "consent-agent",
  }),
);
