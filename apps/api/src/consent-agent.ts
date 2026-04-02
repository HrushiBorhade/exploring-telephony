/**
 * Consent Agent Worker
 *
 * A minimal LiveKit Agent that joins a room with SIP participants,
 * plays a pre-recorded consent announcement, then exits.
 *
 * Run as a separate process:  tsx src/consent-agent.ts dev
 */
import "dotenv/config";
import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  audioFramesFromFile,
  voice,
} from "@livekit/agents";
import path from "node:path";

const CONSENT_AUDIO = path.resolve(__dirname, "../assets/consent.wav");

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();

    // Wait briefly for SIP participants to be fully connected
    await new Promise((r) => setTimeout(r, 500));

    // Create a minimal agent session just for audio playback
    const session = new voice.AgentSession({});

    await session.start({
      agent: new voice.Agent({
        instructions: "Play the consent announcement then stop.",
      }),
      room: ctx.room,
    });

    // Play the pre-recorded consent audio
    await session.say("This call is being recorded for quality and training purposes.", {
      audio: audioFramesFromFile(CONSENT_AUDIO, { sampleRate: 16000, numChannels: 1 }),
    });

    // Brief pause after announcement
    await new Promise((r) => setTimeout(r, 500));

    // Disconnect — the Express webhook will detect this and start egress
    ctx.shutdown();
  },
});

cli.runApp(
  new WorkerOptions({
    agent: __filename,
    agentName: "consent-agent",
  })
);
