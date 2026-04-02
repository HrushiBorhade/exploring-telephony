/**
 * Consent Agent Worker — Single Caller
 *
 * Each caller gets their own consent room with their own agent instance.
 * The agent waits for 1 SIP caller, plays consent, collects DTMF "1",
 * and sets room metadata. The Express server reads the metadata and
 * moves the participant to the main recording room.
 *
 * Run:  tsx src/consent-agent.ts dev
 */
import "dotenv/config";
import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  audioFramesFromFile,
  voice,
} from "@livekit/agents";
import { RoomServiceClient } from "livekit-server-sdk";
import path from "node:path";

const CONSENT_AUDIO = path.resolve(__dirname, "../assets/consent.wav");
const DTMF_TIMEOUT_MS = 30_000;
const CALLER_WAIT_MS = 60_000;

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const room = ctx.room;
    let callerIdentity: string | null = null;
    let consented = false;

    // DTMF listener — registered before connect
    (room as any).on("dtmfReceived", (_code: number, digit: string, participant: any) => {
      if (digit === "1" && participant.identity === callerIdentity) {
        consented = true;
        console.log(`[CONSENT] ${callerIdentity} pressed 1`);
      }
    });

    await ctx.connect();

    // Initialize session immediately — no AEC warmup (one-way announcement)
    const session = new voice.AgentSession({ aecWarmupDuration: 0 });
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

    // Play consent immediately
    console.log(`[CONSENT] ${callerIdentity} joined — playing consent`);
    const handle = session.say(
      "This call is being recorded for quality and training purposes. Press 1 to consent.",
      { audio: audioFramesFromFile(CONSENT_AUDIO, { sampleRate: 16000, numChannels: 1 }) },
    );
    await handle.waitForPlayout();

    // Wait for DTMF "1"
    const dtmfDeadline = Date.now() + DTMF_TIMEOUT_MS;
    while (Date.now() < dtmfDeadline && !consented) {
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`[CONSENT] ${room.name}: ${consented ? "GRANTED" : "DENIED"}`);
    await setMetadata(room.name!, consented);
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
