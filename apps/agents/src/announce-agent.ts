/**
 * Announce Agent — plays a one-shot message when 2 callers are in the room, then exits.
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

const WAIT_FOR_CALLERS_MS = 30_000;

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

    const handle = session.say(
      "Both parties are now connected. This call is being recorded.",
      { allowInterruptions: false },
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
