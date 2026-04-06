/**
 * Announce Agent — plays a one-shot pre-recorded message when 2 callers are in the room, then exits.
 *
 * Uses pre-recorded WAV (like consent agent) to eliminate TTS initialization delay.
 * Callers hear the announcement instantly after joining the capture room.
 *
 * Run:  tsx src/announce-agent.ts dev
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
import fs from "node:fs";
import path from "node:path";

type AudioFrameInstance = { data: Int16Array; sampleRate: number; channels: number; samplesPerChannel: number };
const { AudioFrame } = require("@livekit/rtc-node") as {
  AudioFrame: new (data: Int16Array, sampleRate: number, channels: number, samplesPerChannel: number) => AudioFrameInstance;
};

const ANNOUNCE_AUDIO = path.resolve(__dirname, "../assets/announce_48k.wav");
const SAMPLE_RATE = 48_000;
const NUM_CHANNELS = 1;
const SAMPLES_PER_FRAME = SAMPLE_RATE / 10; // 100ms chunks = 4800 samples
const WAIT_FOR_CALLERS_MS = 30_000;

/**
 * Read a 16-bit PCM WAV file directly into AudioFrame chunks.
 * Same approach as consent agent — zero ffmpeg, zero conversion.
 */
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

export default defineAgent({
  entry: async (ctx: JobContext) => {
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
  },
});

cli.runApp(
  new WorkerOptions({
    agent: __filename,
    agentName: "announce-agent",
  }),
);
