# Product Vision — One Infrastructure, Three Products

## The Insight

A single LiveKit + Telnyx infrastructure serves all three products. The **room** is the universal container — phones, AI agents, and browsers all join as participants. Adding a new product means adding a new type of participant, not rebuilding infrastructure.

```
                    LIVEKIT ROOM
                    ┌─────────────────────────────────────┐
                    │                                     │
  Telnyx SIP ──────→│  Phone A (SIP participant)          │
                    │       ↕ audio                       │
  Telnyx SIP ──────→│  Phone B (SIP participant)          │
                    │       ↕ audio                       │
  Your Agent ──────→│  Eval Agent (server participant)    │←── subscribes to all audio
                    │       ↕ data channel                │     sends prompts to dashboard
  Browser ─────────→│  Observer (web participant)         │←── sees everything live
                    │                                     │
                    │  Auto Track Egress → R2 (recording) │
                    └─────────────────────────────────────┘
```

---

## Product 1: ASR Data Capture (Built)

**What:** Bridge two phone numbers, record per-speaker audio, export as ASR training datasets.

**Who buys this:** AI labs training speech models, companies building voice AI that need labeled conversation data in Indian languages.

```
Room has: Phone A + Phone B
Agent:    None
Egress:   Per-speaker tracks → R2
Output:   3 audio files (mixed + caller A + caller B)
```

Just two SIP participants. No agent. Recording happens automatically via auto track egress. Each speaker's audio is saved as a separate file — no diarization needed.

**Status:** Built and working.

---

## Product 2: Voice Agent Evaluation (Next)

**What:** A company (e.g., Kotak Bank) gives us their voice AI agent's phone number. We connect a human tester to the agent, prompt the tester with a script, transcribe everything in real-time, and generate an evaluation report.

**Who buys this:** Any company deploying voice AI agents — banks, telecom, insurance, e-commerce. They need to know if their agent handles edge cases, speaks the right language, escalates correctly.

```
Room has: Human Tester (Phone) + Company's Voice Agent (Phone) + Your Eval Agent (server)
Agent:    Subscribes to BOTH audio tracks, runs ASR, compares against script
Egress:   Per-speaker tracks → R2
Output:   Evaluation report (accuracy, latency, script adherence, transcript)
```

What changes from Product 1:
- **Phone A** = human tester (same SIP call as before)
- **Phone B** = the company's voice agent phone number (same SIP call as before)
- **ADD**: A LiveKit Agent that joins the room invisibly

The agent:
1. Subscribes to both audio tracks (LiveKit gives separate per-participant audio)
2. Runs real-time ASR (Deepgram via LiveKit STT plugin)
3. Compares tester's speech against the test script
4. Sends "say this next" prompts via **data channel** to the browser dashboard
5. Scores the agent's responses in real-time

```typescript
// This agent joins the SAME room as the phone callers
// It can hear both, but neither caller hears it (it publishes no audio)

const agent = defineAgent({
  entry: async (ctx) => {
    // Subscribe to tester's audio
    const testerTrack = await ctx.waitForTrack(
      (t) => t.participant.identity === "caller_a"
    );

    // Subscribe to voice agent's audio
    const agentTrack = await ctx.waitForTrack(
      (t) => t.participant.identity === "caller_b"
    );

    // Run ASR on both → compare against script → send prompts to dashboard
  }
});
```

**Code changes needed:** Add one file (`eval-agent.ts`), add a "start with eval" option to the API. Room/SIP/recording infrastructure is **identical** to Product 1.

---

## Product 3: Voice AI Agent Builder (Future)

**What:** Companies build their own voice AI agents on our platform. A caller dials in, our agent answers — full STT → LLM → TTS pipeline.

**Who buys this:** Companies that want to deploy voice agents without building the telephony infrastructure themselves.

```
Room has: Caller (Phone) + Your AI Agent (server with STT→LLM→TTS)
Agent:    Full pipeline — listens, thinks, speaks back
Egress:   Per-speaker tracks → R2
Output:   Working voice agent + conversation logs + analytics
```

Same room. Same SIP trunk. Same recording. Just a different agent that now **publishes audio back** (TTS) instead of just observing.

```typescript
const voiceAgent = defineAgent({
  entry: async (ctx) => {
    const session = new AgentSession({
      stt: new DeepgramSTT({ model: "nova-3" }),
      llm: new openai.LLM({ model: "gpt-4o" }),
      tts: new ElevenLabsTTS({ voice: "custom-voice-id" }),
    });

    // Agent listens, thinks, speaks — all handled by the pipeline
    await session.start(ctx.room, ctx.participant);
  }
});
```

**Code changes needed:** Add agent file with STT→LLM→TTS pipeline (~150 lines). Everything else is the same.

---

## What Changes Per Product

| Component | ASR Capture | Agent Eval | Voice Agent |
|-----------|:-----------:|:----------:|:-----------:|
| LiveKit Room | Same | Same | Same |
| Telnyx SIP Trunk | Same | Same | Same |
| `createSipParticipant` | Same | Same | Same |
| R2 Recording (egress) | Same | Same | Same |
| LiveKit Agent | **None** | **Observer** (STT only) | **Full pipeline** (STT→LLM→TTS) |
| Data Channel | No | Yes (prompts to browser) | No |
| Browser Participant | Optional | Yes (dashboard) | Optional |
| **New code needed** | 0 lines | ~100 lines (agent) | ~150 lines (agent) |

---

## Shared Infrastructure

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SHARED (built once, used by all 3)                │
│                                                                      │
│  Telnyx ─── SIP Trunk ─── LiveKit Cloud                             │
│                                │                                     │
│                         ┌──────┴──────┐                              │
│                         │  LiveKit    │                              │
│                         │  Room       │ ← universal container        │
│                         │             │                              │
│                         │  SIP Bridge │ ← phones become participants │
│                         │  Egress     │ ← auto-records everything   │
│                         │  Agents     │ ← plug in any AI logic      │
│                         │  Data Ch.   │ ← real-time to dashboard    │
│                         └──────┬──────┘                              │
│                                │                                     │
│                    Cloudflare R2 (recordings)                        │
│                    PostgreSQL (metadata)                              │
│                    Next.js + shadcn (dashboard)                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Cost

| Item | Monthly (at 100 hrs/day) |
|------|-------------------------|
| LiveKit Cloud (Scale) | $500 + usage |
| Telnyx PSTN (2 legs to India) | ~$5,000–$8,000 |
| Cloudflare R2 (storage) | ~$0 (10GB free tier) |
| Deepgram ASR (Products 2 & 3 only) | ~$500 |
| LLM + TTS (Product 3 only) | ~$2,000–$5,000 |
| **Total: Product 1** | **~$5,500–$8,500/mo** |
| **Total: Product 2** | **~$6,000–$9,000/mo** |
| **Total: Product 3** | **~$8,000–$14,000/mo** |

The infrastructure cost is mostly Telnyx PSTN (phone calls). LiveKit, R2, and the agent framework add ~$500–$1,000. The expensive parts (LLM, TTS) only apply to Product 3.

---

## Why LiveKit is Worth the $500/mo

Without LiveKit, building Products 2 and 3 would require:
- Custom WebSocket audio routing server (~1,200 lines, already tried this)
- Custom agent execution framework
- Custom recording pipeline
- Custom real-time data channel to browser
- Custom multi-participant audio mixing

With LiveKit, the server code for all 3 products is **~230 lines**. Adding a new product means adding a new agent file, not rebuilding infrastructure.

**The $500/mo is the cost of not building infrastructure.**
