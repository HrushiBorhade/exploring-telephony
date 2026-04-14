/**
 * Telephony Agent — Agent-driven single-room architecture.
 *
 * The agent controls the ENTIRE call flow:
 *   1. Dial both phones (await answers)
 *   2. First answers → play hold. Second answers → proceed
 *   3. Play consent, collect DTMF from both
 *   4. Signal egress start → wait 3s → play announcement
 *   5. Shutdown (callers stay and talk, egress records)
 */
import "dotenv/config";
import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
} from "@livekit/agents";
import { SipClient, RoomServiceClient } from "livekit-server-sdk";
import fs from "node:fs";
import path from "node:path";

type AudioFrameInstance = { data: Int16Array; sampleRate: number; channels: number; samplesPerChannel: number };
const { AudioFrame } = require("@livekit/rtc-node") as {
  AudioFrame: new (data: Int16Array, sampleRate: number, channels: number, samplesPerChannel: number) => AudioFrameInstance;
};

// ── Constants ──
const CONSENT_AUDIO = path.resolve(__dirname, "../assets/consent_48k.wav");
const ANNOUNCE_AUDIO = path.resolve(__dirname, "../assets/announce_48k.wav");
const PLEASE_WAIT_AUDIO = path.resolve(__dirname, "../assets/please_wait_48k.wav");
const NO_ANSWER_AUDIO = path.resolve(__dirname, "../assets/no_answer_48k.wav");
const SECOND_NO_ANSWER_AUDIO = path.resolve(__dirname, "../assets/second_no_answer_48k.wav");
const CONSENT_RETRY_AUDIO = path.resolve(__dirname, "../assets/consent_retry_48k.wav");
const CONSENT_TIMEOUT_AUDIO = path.resolve(__dirname, "../assets/consent_timeout_48k.wav");
const SYSTEM_ERROR_AUDIO = path.resolve(__dirname, "../assets/system_error_48k.wav");
const SAMPLE_RATE = 48_000;
const NUM_CHANNELS = 1;
const SAMPLES_PER_FRAME = Math.floor(SAMPLE_RATE * 0.02); // 20ms = 960 samples

const DIAL_TIMEOUT_MS = 45_000;
const DTMF_TIMEOUT_MS = 60_000;
const DTMF_RETRY_MS = 10_000;
const MAX_DTMF_RETRIES = 3;

// ── WAV cache ──
const wavCache = new Map<string, { samples: Int16Array; totalSamples: number }>();

function parseWavFile(filePath: string) {
  if (wavCache.has(filePath)) return wavCache.get(filePath)!;
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
  const cached = { samples, totalSamples: samples.length };
  wavCache.set(filePath, cached);
  return cached;
}

function wavToAudioFrames(filePath: string): ReadableStream<any> {
  const { samples, totalSamples } = parseWavFile(filePath);
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

async function safeSay(session: any, text: string, opts?: { audio?: ReadableStream<any>; allowInterruptions?: boolean }) {
  try {
    const handle = session.say(text, opts);
    await handle.waitForPlayout();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AGENT] say() failed (non-fatal): ${msg}`);
  }
}

function fireSay(session: any, text: string, opts?: { audio?: ReadableStream<any>; allowInterruptions?: boolean }) {
  try {
    session.say(text, opts);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AGENT] fireSay() failed: ${msg}`);
  }
}

// ── LiveKit API clients (lazy — env vars not available during Docker build) ──
let _sipClient: SipClient | null = null;
let _roomClient: RoomServiceClient | null = null;

function getSipClient(): SipClient {
  if (!_sipClient) {
    const url = process.env.LIVEKIT_URL!.replace("wss://", "https://");
    _sipClient = new SipClient(url, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  }
  return _sipClient;
}

function getRoomClient(): RoomServiceClient {
  if (!_roomClient) {
    const url = process.env.LIVEKIT_URL!.replace("wss://", "https://");
    _roomClient = new RoomServiceClient(url, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  }
  return _roomClient;
}

async function setRoomMetadata(roomName: string, metadata: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await getRoomClient().updateRoomMetadata(roomName, JSON.stringify(metadata));
      return true;
    } catch (err: any) {
      console.error(`[AGENT] setRoomMetadata attempt ${attempt}/3 failed: ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  console.error(`[AGENT] CRITICAL: All metadata attempts failed for ${roomName}`);
  return false;
}

// ── Agent ──
export default defineAgent({
  prewarm: async (_proc: JobProcess) => {
    for (const f of [
      CONSENT_AUDIO, ANNOUNCE_AUDIO, PLEASE_WAIT_AUDIO,
      NO_ANSWER_AUDIO, SECOND_NO_ANSWER_AUDIO, CONSENT_RETRY_AUDIO,
      CONSENT_TIMEOUT_AUDIO, SYSTEM_ERROR_AUDIO,
    ]) {
      if (fs.existsSync(f)) {
        parseWavFile(f);
        console.log(`[PREWARM] Cached: ${path.basename(f)}`);
      }
    }
  },

  entry: async (ctx: JobContext) => {
    const room = ctx.room;
    const metadata = JSON.parse(ctx.job.metadata || "{}");
    const captureId = metadata.captureId || "unknown";
    const phoneA: string = metadata.phoneA;
    const phoneB: string = metadata.phoneB;
    const sipTrunkId: string = metadata.sipTrunkId;
    const log = (msg: string) => console.log(`[AGENT:${captureId}] ${msg}`);

    if (!phoneA || !phoneB || !sipTrunkId) {
      log("CRITICAL: Missing phoneA, phoneB, or sipTrunkId in metadata");
      return;
    }

    // DTMF tracking
    const consentedCallers = new Set<string>();
    (room as any).on("dtmfReceived", (code: number, digit: string, participant: any) => {
      if (participant?.identity === "caller_a" || participant?.identity === "caller_b") {
        consentedCallers.add(participant.identity);
        log(`DTMF from ${participant.identity}: digit=${digit} (${consentedCallers.size}/2)`);
      }
    });

    // ── Phase 1: Connect + start session ──
    await ctx.connect();
    log(`Connected to room ${room.name}`);

    const session = new voice.AgentSession({
      aecWarmupDuration: 0,
    });
    await session.start({
      agent: new voice.Agent({ instructions: "Telephony capture agent." }),
      room,
      inputOptions: { closeOnDisconnect: false },
    });
    log("Session started");

    // ── Phase 2: Dial both phones (agent-driven, like Python reference) ──
    log("Dialing both phones...");

    const dialWithTimeout = (phone: string, identity: string): Promise<string> => {
      const dial = getSipClient().createSipParticipant(sipTrunkId, phone, room.name!, {
        participantIdentity: identity,
        participantName: phone,
        waitUntilAnswered: true,
      });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("pickup_timeout")), DIAL_TIMEOUT_MS),
      );
      return Promise.race([dial, timeout]).then(() => identity);
    };

    const dialA = dialWithTimeout(phoneA, "caller_a");
    const dialB = dialWithTimeout(phoneB, "caller_b");

    // Wait for first answer (like Python's asyncio.wait FIRST_COMPLETED)
    type DialResult = { answeredId: string; otherDial: Promise<string> };
    const firstAnswered = await Promise.race<DialResult>([
      dialA.then((id) => ({ answeredId: id, otherDial: dialB })),
      dialB.then((id) => ({ answeredId: id, otherDial: dialA })),
    ]).catch((err) => {
      log(`First dial failed: ${err.message}`);
      return null;
    });

    if (!firstAnswered) {
      log("Neither phone answered");
      await safeSay(session, "Neither party answered the call. Goodbye.", {
        audio: wavToAudioFrames(NO_ANSWER_AUDIO),
      });
      await setRoomMetadata(room.name!, { announced: false, error: "no_answer" });
      ctx.shutdown();
      return;
    }

    log(`${firstAnswered.answeredId} answered first — playing hold`);
    fireSay(session, "Please wait for the other party.", {
      allowInterruptions: true,
      audio: wavToAudioFrames(PLEASE_WAIT_AUDIO),
    });

    // Wait for second answer
    const secondId = await firstAnswered.otherDial.catch((err) => {
      log(`Second dial failed: ${err.message}`);
      return null;
    });

    if (!secondId) {
      log("Second phone didn't answer");
      await safeSay(session, "The other party did not answer. Goodbye.", {
        audio: wavToAudioFrames(SECOND_NO_ANSWER_AUDIO),
      });
      await setRoomMetadata(room.name!, { announced: false, error: "second_no_answer" });
      ctx.shutdown();
      return;
    }

    log(`Both answered: ${firstAnswered.answeredId}, ${secondId}`);

    // Brief pause after both join (let audio settle)
    await new Promise((r) => setTimeout(r, 1000));

    // ── Phase 3: Play consent prompt ──
    log("Playing consent prompt");
    consentedCallers.clear(); // Discard any DTMF from hold phase

    await safeSay(session, "This call is being recorded for quality and training purposes. Press any key to consent.", {
      audio: wavToAudioFrames(CONSENT_AUDIO),
      allowInterruptions: false,
    });
    log("Consent prompt finished");

    // ── Phase 4: Wait for DTMF from both (with retries) ──
    log("Waiting for DTMF from both...");
    const dtmfDeadline = Date.now() + DTMF_TIMEOUT_MS;
    let retryCount = 0;
    let lastPromptAt = Date.now();

    while (Date.now() < dtmfDeadline && consentedCallers.size < 2) {
      // Retry if partial/no consent after 10s
      if (consentedCallers.size < 2 && Date.now() - lastPromptAt > DTMF_RETRY_MS && retryCount < MAX_DTMF_RETRIES) {
        retryCount++;
        const missing = ["caller_a", "caller_b"].filter((c) => !consentedCallers.has(c));
        log(`Consent incomplete (${consentedCallers.size}/2) — retry ${retryCount}/${MAX_DTMF_RETRIES}, waiting: ${missing.join(", ")}`);
        await safeSay(session, "We haven't received consent from all parties. Please press any key on your phone to consent.", {
          audio: wavToAudioFrames(CONSENT_RETRY_AUDIO),
        });
        lastPromptAt = Date.now();
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (consentedCallers.size < 2) {
      log(`Consent timeout — ${consentedCallers.size}/2 (${[...consentedCallers].join(", ")})`);
      await safeSay(session, "Consent was not received from both parties. This call is ending.", {
        audio: wavToAudioFrames(CONSENT_TIMEOUT_AUDIO),
      });
      await setRoomMetadata(room.name!, {
        announced: false,
        error: "consent_timeout",
        consentA: consentedCallers.has("caller_a"),
        consentB: consentedCallers.has("caller_b"),
      });
      ctx.shutdown();
      return;
    }

    // ── Phase 5: Signal egress start ──
    log("Both consented — signaling egress");
    const written = await setRoomMetadata(room.name!, {
      announced: true,
      consentA: true,
      consentB: true,
    });

    if (!written) {
      log("CRITICAL: metadata write failed");
      await safeSay(session, "A system error occurred. This call will end.", {
        audio: wavToAudioFrames(SYSTEM_ERROR_AUDIO),
      });
      ctx.shutdown();
      return;
    }

    // ── Phase 6: Wait for egress initialization ──
    log("Waiting 3s for egress initialization...");
    await new Promise((r) => setTimeout(r, 3000));

    // ── Phase 7: Play announcement ──
    log("Playing announcement");
    await safeSay(session, "Both parties have consented. Recording has begun.", {
      allowInterruptions: false,
      audio: wavToAudioFrames(ANNOUNCE_AUDIO),
    });

    log("Done — callers stay connected, egress recording");
    ctx.shutdown();
  },
});

cli.runApp(
  new WorkerOptions({
    agent: __filename,
    agentName: "telephony-agent",
    numIdleProcesses: 10,
  }),
);
