# LiveKit Agents — Complete Guide

> How agents work from first principles, how they're used in our app, and how to deploy, modify, and scale them in production.

---

## Table of Contents

1. [What Is a LiveKit Agent?](#1-what-is-a-livekit-agent)
2. [How Agent Dispatch Works (First Principles)](#2-how-agent-dispatch-works-first-principles)
3. [Our Agents — What They Do](#3-our-agents--what-they-do)
4. [Architecture — How Our App Uses Agents](#4-architecture--how-our-app-uses-agents)
5. [Running Locally](#5-running-locally)
6. [Deployment Options](#6-deployment-options)
7. [How to Add or Modify an Agent](#7-how-to-add-or-modify-an-agent)
8. [Production Best Practices](#8-production-best-practices)
9. [Key References](#9-key-references)

---

## 1. What Is a LiveKit Agent?

A LiveKit Agent is a **server-side program that joins a LiveKit room as a participant** — just like a human user joins via a browser or phone. But instead of a human, it's code that can:

- **Listen** to audio (via Speech-to-Text)
- **Speak** (via Text-to-Speech)
- **Think** (via LLM)
- **React** to events (participants joining, DTMF tones, room metadata changes)

Think of it as a bot that sits in a call room and does things autonomously.

### The Mental Model

```
Human callers ──────┐
                    │
                    ▼
              LiveKit Room
                    │
                    ├── caller_a (phone via SIP)
                    ├── caller_b (phone via SIP)
                    └── consent-agent (your code, joins as a participant)
                            │
                            ├── Plays audio: "Press 1 to consent"
                            ├── Listens for DTMF "1"
                            └── Sets room metadata: { consent: true }
```

The agent is NOT a webhook handler or an API endpoint. It's a **real-time participant** in the room with access to audio streams, data channels, and room events.

---

## 2. How Agent Dispatch Works (First Principles)

### The Four Phases

Source: [LiveKit Server Lifecycle](https://docs.livekit.io/agents/server/lifecycle)

```
Phase 1: REGISTRATION
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  Your agent code starts → connects to LiveKit (Cloud or         │
│  self-hosted) via WebSocket → registers itself:                 │
│                                                                  │
│    "I am 'consent-agent', I'm available for jobs"               │
│                                                                  │
│  Now it sits idle, waiting.                                     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Phase 2: DISPATCH
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  Your API server calls:                                         │
│    agentDispatch.createDispatch(roomName, "consent-agent")      │
│                                                                  │
│  LiveKit server receives this and looks for an available        │
│  agent server registered as "consent-agent".                    │
│                                                                  │
│  Dispatch time: < 150ms (LiveKit handles load balancing)        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Phase 3: JOB EXECUTION
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  The agent server spawns a NEW SUBPROCESS for this job.         │
│  The subprocess:                                                │
│    1. Joins the room as a participant                           │
│    2. Runs your entry() function                                │
│    3. Does its work (play audio, listen, set metadata)          │
│    4. Calls ctx.shutdown() when done                            │
│                                                                  │
│  Each job = isolated subprocess. One agent server can handle    │
│  10-25 concurrent jobs.                                         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Phase 4: CLEANUP
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  Job subprocess exits. Room is closed when the last             │
│  non-agent participant leaves.                                  │
│  Agent server goes back to waiting for the next dispatch.       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Automatic vs Explicit Dispatch

Source: [Agent Dispatch Docs](https://docs.livekit.io/agents/server/agent-dispatch)

| Type | How It Works | When to Use |
|------|-------------|-------------|
| **Automatic** | Agent joins EVERY new room automatically | Chatbots, always-on assistants |
| **Explicit** | Agent joins ONLY when you call `createDispatch()` | Our use case — consent flow on demand |

**We use explicit dispatch** because we only want agents in consent rooms, not every room.

When you set `agentName` in `WorkerOptions`, automatic dispatch is **disabled** — the agent only responds to explicit dispatch calls:

```typescript
// This disables auto-dispatch. Agent only runs when explicitly dispatched.
cli.runApp(
  new WorkerOptions({
    agent: __filename,
    agentName: "consent-agent",  // ← explicit dispatch only
  }),
);
```

### Passing Data to Agents

You can pass metadata when dispatching:

```typescript
// In your API server
await agentDispatch.createDispatch(roomName, "consent-agent", {
  metadata: JSON.stringify({ userId: "123", language: "en" })
});

// In your agent — access via JobContext
entry: async (ctx: JobContext) => {
  const metadata = JSON.parse(ctx.job.metadata || "{}");
  console.log(metadata.userId);  // "123"
}
```

---

## 3. Our Agents — What They Do

### consent-agent

**File:** `apps/api/src/consent-agent.ts` (to be moved to `apps/agents/`)

**Purpose:** Collect recording consent from each caller via DTMF (phone keypress).

**Flow:**
```
1. Agent joins consent room (e.g., "consent-abc123-a")
2. Waits for SIP caller to join (caller_a or caller_b)
3. Plays pre-recorded consent message (WAV file, direct PCM — no ffmpeg)
4. Waits up to 30s for DTMF "1" keypress
5. Sets room metadata: { consent: true } or { consent: false }
6. If consented: loops "please wait" until caller is moved to capture room
7. Shuts down
```

**Key Details:**
- Uses `voice.AgentSession` with Cartesia Sonic 3 TTS for "please wait" messages
- Plays consent audio from a pre-recorded WAV file (not TTS) for legal consistency
- Listens for DTMF events (phone keypresses), not voice
- One agent instance per caller (two consent rooms = two agent instances)

### announce-agent

**File:** `apps/api/src/announce-agent.ts` (to be moved to `apps/agents/`)

**Purpose:** Play a one-shot announcement when both callers are in the capture room.

**Flow:**
```
1. Agent joins capture room (e.g., "capture-abc123")
2. Waits until both caller_a and caller_b are present (up to 30s)
3. Plays: "Both parties are now connected. This call is being recorded."
4. Shuts down immediately
```

**Key Details:**
- Fire-and-forget — plays one message, exits
- Uses Cartesia Sonic 3 TTS
- No interaction with callers beyond the announcement

---

## 4. Architecture — How Our App Uses Agents

### The Complete Call Flow

```
User clicks "Start Capture" in the web UI
            │
            ▼
    POST /api/captures/:id/start  (Express API)
            │
            ├── 1. Create 3 LiveKit rooms:
            │       consent-{id}-a
            │       consent-{id}-b
            │       capture-{id}
            │
            ├── 2. Dispatch consent agents:
            │       agentDispatch.createDispatch("consent-{id}-a", "consent-agent")
            │       agentDispatch.createDispatch("consent-{id}-b", "consent-agent")
            │
            ├── 3. Dial both phones via SIP:
            │       sipClient.createSipParticipant(trunkId, phoneA, "consent-{id}-a")
            │       sipClient.createSipParticipant(trunkId, phoneB, "consent-{id}-b")
            │
            ├── 4. Wait for consent from both rooms:
            │       waitForConsent("consent-{id}-a")  ← resolved by webhook
            │       waitForConsent("consent-{id}-b")  ← resolved by webhook
            │
            ├── 5. If both consent:
            │       Move callers to capture room
            │       Dispatch announce agent
            │       Start recording (egress)
            │
            └── 6. If either denies:
                    End capture, clean up rooms
```

### What Runs Where

```
┌──────────────────────────────────────────────────────────────────┐
│  YOUR INFRASTRUCTURE (ECS Fargate)                               │
│                                                                  │
│  ┌─────────────────────────────────────────┐                    │
│  │  Express API Server                      │                    │
│  │  - Creates rooms                         │                    │
│  │  - Calls agentDispatch.createDispatch()  │                    │
│  │  - Handles webhooks                      │                    │
│  │  - Manages capture lifecycle             │                    │
│  │  - Does NOT run agent code               │                    │
│  └─────────────────────────────────────────┘                    │
│                                                                  │
│  Uses livekit-server-sdk (HTTP API client, ~2MB)                │
│  Does NOT need @livekit/agents (~600MB)                         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
            │
            │ createDispatch() → HTTP to LiveKit Cloud
            │ webhooks ← HTTP from LiveKit Cloud
            ▼
┌──────────────────────────────────────────────────────────────────┐
│  LIVEKIT CLOUD (or self-hosted)                                  │
│                                                                  │
│  - Manages rooms, participants, audio routing                   │
│  - Routes dispatch requests to available agent workers          │
│  - Sends webhooks back to your API                              │
│  - Handles SIP trunking (Telnyx)                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
            │
            │ Dispatches jobs to agent workers
            ▼
┌──────────────────────────────────────────────────────────────────┐
│  AGENT WORKERS (LiveKit Cloud hosted OR self-hosted)            │
│                                                                  │
│  ┌─────────────────────┐  ┌──────────────────────┐             │
│  │  consent-agent       │  │  announce-agent       │             │
│  │  - Joins room        │  │  - Joins room         │             │
│  │  - Plays audio       │  │  - Plays announcement │             │
│  │  - Collects DTMF     │  │  - Exits              │             │
│  │  - Sets metadata     │  │                        │             │
│  └─────────────────────┘  └──────────────────────┘             │
│                                                                  │
│  Uses @livekit/agents + @livekit/agents-plugin-silero           │
│  (onnxruntime-node for VAD, ~600MB)                             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**The API server and agent workers are completely separate processes.** The API only needs `livekit-server-sdk` to call the dispatch API. The agents need `@livekit/agents` to join rooms and interact with audio.

---

## 5. Running Locally

### Prerequisites

```bash
# Install LiveKit CLI
brew install livekit-cli

# Set environment variables (in .env)
LIVEKIT_URL=wss://your-app.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxx
LIVEKIT_SIP_TRUNK_ID=ST_xxxxxxxxxxxxx
```

### Start Everything

You need **3 terminal windows:**

```bash
# Terminal 1: Express API
pnpm dev:api

# Terminal 2: Consent agent worker
cd apps/agents   # (after the split)
tsx src/consent-agent.ts dev

# Terminal 3: Announce agent worker
cd apps/agents
tsx src/announce-agent.ts dev
```

The `dev` command:
- Connects to LiveKit Cloud
- Registers the agent
- Enables auto-reconnect on disconnect
- Uses debug-level logging
- Hot-reloads on file changes (when using tsx)

### Testing a Specific Room

You can test an agent in a specific room without dispatch:

```bash
node consent-agent.js connect --room test-room --participant-identity test-agent
```

### Download VAD Model (First Time)

Silero VAD needs a model file. Download it first:

```bash
tsx src/consent-agent.ts download-files
```

---

## 6. Deployment Options

### Option A: LiveKit Cloud (Recommended to Start)

LiveKit hosts and scales your agents for you.

```bash
cd apps/agents
lk agent create
```

This command:
1. Generates `Dockerfile`, `.dockerignore`, `livekit.toml` in your directory
2. Builds a Docker image from your code
3. Pushes it to LiveKit Cloud's registry
4. Registers the agent with your LiveKit Cloud project
5. Starts running it

**Updating the agent:**

```bash
lk agent update
```

Uses **rolling deployment** — new instances serve new sessions, old instances get up to 1 hour to finish active sessions. Zero downtime.

**Pros:**
- Zero infrastructure to manage
- Auto-scaling built in
- Rolling deploys with zero downtime
- Logs and traces in LiveKit dashboard

**Cons:**
- Less control over infrastructure
- Dependent on LiveKit Cloud pricing and limits
- Agent code runs on LiveKit's servers (data locality concerns)

### Option B: Self-Hosted on ECS (Full Control)

Your agents run as ECS Fargate services alongside your API.

**Dockerfile for agents:**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
COPY assets/ ./assets/

# Download VAD model at build time
RUN node dist/consent-agent.js download-files

ENV NODE_ENV=production
# No EXPOSE needed — agents make outbound connections only
CMD ["node", "dist/consent-agent.js", "start"]
```

**ECS Task Definition (conceptual):**

```
ECS Cluster
├── Service: telephony-api
│   ├── Image: <account>.dkr.ecr.ap-south-1.amazonaws.com/telephony-api:latest
│   ├── Port: 8080
│   ├── ALB: yes
│   └── Scaling: 2-10 tasks based on CPU
│
├── Service: consent-agent
│   ├── Image: <account>.dkr.ecr.ap-south-1.amazonaws.com/telephony-agents:latest
│   ├── Command: ["node", "dist/consent-agent.js", "start"]
│   ├── Port: none (outbound WebSocket only)
│   ├── ALB: no
│   └── Scaling: 2-5 tasks (each handles 10-25 concurrent jobs)
│
└── Service: announce-agent
    ├── Image: same agents image, different CMD
    ├── Command: ["node", "dist/announce-agent.js", "start"]
    ├── Port: none
    ├── ALB: no
    └── Scaling: 1-3 tasks
```

**Pros:**
- Full control over infrastructure, scaling, costs
- Data stays in your AWS account
- Can use same VPC/security groups as API

**Cons:**
- You manage scaling, monitoring, deployments
- Need to handle graceful shutdown (10+ min grace period for voice calls)

### Option C: Hybrid (Production Recommendation)

Start with **LiveKit Cloud** (Option A) for agents, **ECS** for API.

Migrate to self-hosted agents (Option B) when:
- You need data locality requirements
- You have 50+ concurrent agent sessions
- LiveKit Cloud costs exceed self-hosted costs
- You need custom scaling logic

---

## 7. How to Add or Modify an Agent

### Adding a New Agent

**Step 1: Create the agent file**

```typescript
// apps/agents/src/my-new-agent.ts
import "dotenv/config";
import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  inference,
  voice,
} from "@livekit/agents";

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();

    // Access dispatch metadata
    const metadata = JSON.parse(ctx.job.metadata || "{}");

    // Set up TTS
    const session = new voice.AgentSession({
      tts: new inference.TTS({ model: "cartesia/sonic-3" }),
    });

    await session.start({
      agent: new voice.Agent({ instructions: "Your instructions here." }),
      room: ctx.room,
    });

    // Wait for a participant
    const participant = await ctx.waitForParticipant();
    console.log(`Participant joined: ${participant.identity}`);

    // Do your thing
    const handle = session.say("Hello! How can I help?");
    await handle.waitForPlayout();

    ctx.shutdown();
  },
});

cli.runApp(
  new WorkerOptions({
    agent: __filename,
    agentName: "my-new-agent",  // Must be unique
  }),
);
```

**Step 2: Add scripts to package.json**

```json
{
  "scripts": {
    "dev:my-new-agent": "tsx src/my-new-agent.ts dev",
    "start:my-new-agent": "node dist/my-new-agent.js start"
  }
}
```

**Step 3: Dispatch from API**

```typescript
// In your Express route
await agentDispatch.createDispatch(roomName, "my-new-agent", {
  metadata: JSON.stringify({ userId, language })
});
```

**Step 4: Run locally**

```bash
tsx src/my-new-agent.ts dev
```

**Step 5: Deploy**

```bash
# LiveKit Cloud
lk agent update

# Self-hosted: rebuild Docker, update ECS service
```

### Adding Tools to an Agent (Function Calling)

Source: [LiveKit Agents JS README](https://github.com/livekit/agents-js)

```typescript
import { llm, voice, inference } from "@livekit/agents";
import { z } from "zod";

const lookupOrder = llm.tool({
  description: "Look up a customer order by order ID",
  parameters: z.object({
    orderId: z.string().describe("The order ID to look up"),
  }),
  execute: async ({ orderId }) => {
    const order = await db.getOrder(orderId);
    return { status: order.status, eta: order.eta };
  },
});

const agent = new voice.Agent({
  instructions: "You are a customer service agent. Help users track orders.",
  tools: { lookupOrder },
  stt: new inference.STT({ model: "deepgram/nova-3", language: "en" }),
  llm: new inference.LLM({ model: "openai/gpt-4.1-mini" }),
  tts: new inference.TTS({ model: "cartesia/sonic-3" }),
});
```

### Adding Voice Activity Detection (VAD)

```typescript
import * as silero from "@livekit/agents-plugin-silero";

export default defineAgent({
  // Prewarm loads the VAD model ONCE when the agent server starts
  // (not per-job — this is important for performance)
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: new inference.STT({ model: "deepgram/nova-3" }),
      llm: new inference.LLM({ model: "openai/gpt-4.1-mini" }),
      tts: new inference.TTS({ model: "cartesia/sonic-3" }),
    });
    // ...
  },
});
```

### Modifying an Existing Agent

1. Edit the agent file
2. Test locally: `tsx src/consent-agent.ts dev`
3. Deploy:
   - LiveKit Cloud: `lk agent update`
   - Self-hosted: rebuild image, ECS rolling deploy

Changes to agents do NOT require changes to the API server (unless you're changing the dispatch call).

---

## 8. Production Best Practices

Source: [LiveKit Self-hosted Deployments](https://docs.livekit.io/agents/ops/deployment/custom)

### Resource Sizing

| Component | CPU | Memory | Concurrent Jobs |
|-----------|-----|--------|-----------------|
| Agent server (voice AI) | 4 cores | 8 GB | 10-25 jobs |
| Agent server (lightweight, like ours) | 1 core | 2 GB | 25-50 jobs |

> LiveKit recommends **4 cores and 8GB per agent server** as a starting rule for most voice AI apps. Our agents are lightweight (no STT/LLM, just TTS + DTMF), so they need less.

### Graceful Shutdown

Voice calls can't be interrupted mid-conversation. Configure long grace periods:

```yaml
# Kubernetes
spec:
  terminationGracePeriodSeconds: 600  # 10 minutes

# ECS
deregistration_delay = 600  # 10 minutes
stop_timeout         = 600
```

Agent servers handle this automatically:
- On SIGTERM: stop accepting new jobs
- Running jobs continue to completion
- Process exits only when all jobs are done

### Environment Variables

```bash
# Required for ALL agent workers
LIVEKIT_URL=wss://your-app.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# Agent-specific (if using external AI services)
# OPENAI_API_KEY=...     # Only if using OpenAI LLM
# DEEPGRAM_API_KEY=...   # Only if using Deepgram STT

# Our agents use LiveKit Inference (Cartesia TTS) — no extra keys needed
```

### Scaling

- LiveKit automatically load-balances dispatch across available agent servers
- Scale agent servers horizontally (more ECS tasks / more pods)
- Each agent server handles 10-25 concurrent jobs by default
- For our lightweight agents: 2-3 agent servers can handle 50-100 concurrent calls

### Monitoring

- LiveKit Cloud: built-in dashboard with traces, transcripts, metrics
- Self-hosted: agent servers expose metrics, integrate with Prometheus/Grafana
- Key metrics to watch:
  - Active jobs per agent server
  - Dispatch latency (should be < 150ms)
  - Job failure rate
  - Agent session duration

### Logging

```typescript
// Use structured logging in agents (not console.log)
import pino from "pino";
const logger = pino({ name: "consent-agent" });

// In your agent entry()
logger.info({ roomName: room.name, caller: callerIdentity }, "Caller joined");
```

---

## 9. Key References

### Official Docs
- [LiveKit Agents Overview](https://docs.livekit.io/agents/)
- [Agent Dispatch (Explicit)](https://docs.livekit.io/agents/server/agent-dispatch)
- [Server Lifecycle](https://docs.livekit.io/agents/server/lifecycle)
- [Deploying to LiveKit Cloud](https://docs.livekit.io/agents/ops/deployment/)
- [Self-hosted Deployments](https://docs.livekit.io/agents/ops/deployment/custom)
- [Node.js Agents SDK](https://github.com/livekit/agents-js)

### GitHub Examples
- [Agent Starter (Node.js)](https://github.com/livekit-examples/agent-starter-node)
- [Agent Deployment Examples](https://github.com/livekit-examples/agent-deployment)
- [Python Agent Examples](https://github.com/livekit-examples/python-agents-examples)

### Our Codebase
- `apps/api/src/consent-agent.ts` — Consent collection agent
- `apps/api/src/announce-agent.ts` — Recording announcement agent
- `apps/api/src/lib/livekit.ts` — LiveKit client initialization (roomService, sipClient, egressClient, agentDispatch)
- `apps/api/src/routes/captures.ts` — Where `agentDispatch.createDispatch()` is called
- `apps/api/src/services/consent.ts` — Promise-based consent resolution (webhook + polling)

---

## Quick Decision Matrix

| Question | Answer |
|----------|--------|
| Do I need to change how agents are dispatched? | Edit `apps/api/src/routes/captures.ts` |
| Do I need to change what an agent does? | Edit the agent file in `apps/agents/src/` |
| Do I need a new type of agent? | Create new file, add `agentName`, dispatch from API |
| Do I need to redeploy agents? | `lk agent update` (Cloud) or rebuild Docker (self-hosted) |
| Do I need to redeploy the API? | Only if you changed dispatch logic |
| Can agents access my database? | Yes if self-hosted (same VPC). No if LiveKit Cloud hosted. |
| Can agents call external APIs? | Yes — they're just Node.js processes |
| Do agents share state with the API? | No — communication is via room metadata + webhooks |
