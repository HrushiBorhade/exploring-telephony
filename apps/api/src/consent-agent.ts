/**
 * Consent Agent Worker
 *
 * Plays pre-recorded consent announcement via session.say() + audioFramesFromFile()
 * (proven working approach), then collects DTMF "1" from both SIP callers.
 * Sets room metadata with consent result for the Express webhook to read.
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
const CONSENT_TIMEOUT_MS = 30_000;

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const room = ctx.room;

    // Set up DTMF + disconnect listeners BEFORE connecting (per LiveKit docs)
    const sipCallers = new Set<string>();
    const consented = new Set<string>();

    const dtmfHandler = (_code: number, digit: string, participant: any) => {
      if (digit === "1" && sipCallers.has(participant.identity)) {
        consented.add(participant.identity);
        console.log(`[CONSENT] ${participant.identity} pressed 1 (${consented.size}/${sipCallers.size})`);
      }
    };

    const disconnectHandler = (participant: any) => {
      if (sipCallers.has(participant.identity)) {
        sipCallers.delete(participant.identity);
        console.log(`[CONSENT] ${participant.identity} left during consent`);
      }
    };

    (room as any).on("dtmfReceived", dtmfHandler);
    (room as any).on("participantDisconnected", disconnectHandler);

    await ctx.connect();

    // Wait for SIP callers to appear (SDK participant sync can lag)
    const callerDeadline = Date.now() + 10_000;
    while (Date.now() < callerDeadline) {
      for (const p of room.remoteParticipants.values()) {
        if (p.identity === "caller_a" || p.identity === "caller_b") {
          sipCallers.add(p.identity);
        }
      }
      if (sipCallers.size >= 2) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    if (sipCallers.size === 0) {
      console.log("[CONSENT] No SIP callers found, exiting");
      const rs = new RoomServiceClient(
        process.env.LIVEKIT_URL!.replace("wss://", "https://"),
        process.env.LIVEKIT_API_KEY!,
        process.env.LIVEKIT_API_SECRET!,
      );
      await rs.updateRoomMetadata(room.name!, JSON.stringify({ consent: false }));
      ctx.shutdown();
      return;
    }
    console.log(`[CONSENT] Callers: ${[...sipCallers].join(", ")}`);

    // Play consent audio using the proven session.say() + audioFramesFromFile() approach
    const session = new voice.AgentSession({});
    await session.start({
      agent: new voice.Agent({ instructions: "Play consent announcement." }),
      room,
    });

    const handle = session.say(
      "This call is being recorded for quality and training purposes. Press 1 to consent.",
      { audio: audioFramesFromFile(CONSENT_AUDIO, { sampleRate: 16000, numChannels: 1 }) },
    );

    // Wait for actual audio playout to finish (say() returns a SpeechHandle immediately)
    if (handle?.waitForPlayout) await handle.waitForPlayout();

    console.log("[CONSENT] Audio played, waiting for DTMF...");

    // Wait for DTMF "1" from all SIP callers (or timeout)
    const deadline = Date.now() + CONSENT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (sipCallers.size === 0) break;
      if (consented.size >= sipCallers.size) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    // Cleanup listeners
    (room as any).off("dtmfReceived", dtmfHandler);
    (room as any).off("participantDisconnected", disconnectHandler);

    const granted = sipCallers.size > 0 && consented.size >= sipCallers.size;
    console.log(`[CONSENT] ${granted ? "GRANTED" : "DENIED"} (${consented.size}/${sipCallers.size})`);

    // Set room metadata so Express webhook knows the result
    const rs = new RoomServiceClient(
      process.env.LIVEKIT_URL!.replace("wss://", "https://"),
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
    );
    try {
      await rs.updateRoomMetadata(room.name!, JSON.stringify({ consent: granted }));
    } catch (err: any) {
      // Room may have been deleted if callers hung up during consent
      console.error(`[CONSENT] Failed to set metadata: ${err.message}`);
    }

    ctx.shutdown();
  },
});

cli.runApp(
  new WorkerOptions({
    agent: __filename,
    agentName: "consent-agent",
  }),
);
