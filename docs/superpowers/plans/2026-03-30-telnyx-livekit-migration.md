# Telnyx + LiveKit Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Twilio with Telnyx + LiveKit for phone call bridging and recording. Remove real-time ASR. Store dual-channel recordings for offline processing.

**Architecture:** Telnyx provides PSTN connectivity (phone numbers, call routing) via SIP trunk to LiveKit Cloud. LiveKit manages rooms (bridging callers), SIP participants (dialing phones), and egress (recording). Express backend orchestrates via LiveKit server SDK. No WebSocket media stream handling — LiveKit handles all media.

**Tech Stack:** Telnyx (SIP trunk), LiveKit Cloud (rooms, SIP bridge, egress), `livekit-server-sdk` (Node.js), Express, Drizzle ORM, PostgreSQL, Next.js + shadcn/ui.

---

## Prerequisites (Manual — Before Starting)

These require human action in web dashboards. Complete before Task 1.

### P1: Telnyx Account Setup

1. Sign up at https://portal.telnyx.com
2. Buy a phone number (Mission Control → Numbers → Buy)
3. Create a SIP Connection:
   - Mission Control → SIP Trunking → Create SIP Connection
   - Type: "Credential Authentication"
   - Note the **Connection ID**, **username**, **password**
4. Get your **API Key** from Mission Control → API Keys

### P2: LiveKit Cloud Setup

1. Sign up at https://cloud.livekit.io
2. Create a project → note the **URL** (wss://xxx.livekit.cloud)
3. Settings → API Keys → Create → note **API Key** and **API Secret**

### P3: Configure Telnyx as LiveKit SIP Provider

Follow https://docs.livekit.io/telephony/start/providers/telnyx/

1. In Telnyx Mission Control → SIP Trunking → your connection:
   - Set "Receive Settings" → SIP URI: your LiveKit SIP URI
2. In LiveKit (via code in Task 3): create outbound SIP trunk pointing to `sip.telnyx.com`
3. Note the **outbound trunk ID** (starts with `ST_`)

### P4: Update .env

```env
# Remove these:
# TWILIO_ACCOUNT_SID=...
# TWILIO_AUTH_TOKEN=...
# TWILIO_PHONE_NUMBER=...
# DEEPGRAM_API_KEY=...

# Add these:
TELNYX_PHONE_NUMBER=+1xxxxxxxxxx
LIVEKIT_URL=wss://your-app.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxx
LIVEKIT_SIP_TRUNK_ID=ST_xxxxxxxxxxxxx

# Keep these:
DATABASE_URL=postgresql://hrushiborhade@localhost:5432/telephony
PORT=3001
```

---

## File Structure

### Files to CREATE:

| File | Responsibility |
|------|---------------|
| `src/livekit.ts` | LiveKit SDK client initialization (RoomServiceClient, SipClient, EgressClient) |

### Files to MODIFY:

| File | What changes |
|------|-------------|
| `package.json` | Remove `twilio`, `@deepgram/sdk`, `ws`, `@types/ws`. Add `livekit-server-sdk`. |
| `src/server.ts` | Major rewrite: remove TwiML, WebSocket servers, Deepgram, media stream handler. Add LiveKit room/SIP/egress calls. |
| `src/types.ts` | Remove `CaptureTranscriptEntry` (no live transcription). Add `captureStatus` tracking fields. |
| `src/db/schema.ts` | Remove `captureWords` and `captureTranscripts` tables. Add `egressId` to captures. Simplify. |
| `src/db/queries.ts` | Remove word/transcript persistence. Simplify to capture CRUD + recording URL. |
| `src/audio.ts` | Replace mulaw WAV writer with LiveKit recording downloader. |
| `.env.example` | Replace Twilio/Deepgram vars with Telnyx/LiveKit vars. |
| `web/src/lib/types.ts` | Remove transcript/word types. Simplify capture type. |
| `web/src/lib/use-session-socket.ts` | Remove entirely (no live WebSocket updates). |
| `web/src/app/capture/page.tsx` | Remove WebSocket dependency. Poll API for status. |
| `web/src/app/capture/[id]/page.tsx` | Remove live transcript panel. Show call status + recording after end. |
| `web/src/app/capture/[id]/review/page.tsx` | Remove (no word-level data yet — offline ASR comes later). |

### Files to DELETE:

| File | Why |
|------|-----|
| `web/src/lib/use-session-socket.ts` | No more WebSocket live updates |
| `web/src/app/capture/[id]/review/page.tsx` | Offline ASR review comes later |
| `web/src/app/session/[id]/page.tsx` | Agent testing mode removed for now (add back later with LiveKit agents) |

---

## Tasks

### Task 1: Swap dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove old packages**

```bash
npm uninstall twilio @deepgram/sdk ws @types/ws
```

- [ ] **Step 2: Install new packages**

```bash
npm install livekit-server-sdk
```

- [ ] **Step 3: Verify package.json**

```bash
cat package.json | grep -E "twilio|deepgram|ws|livekit"
```

Expected: Only `livekit-server-sdk` appears in dependencies. No `twilio`, `@deepgram/sdk`, `ws`, or `@types/ws`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: swap Twilio/Deepgram/ws for livekit-server-sdk"
```

---

### Task 2: Create LiveKit client module

**Files:**
- Create: `src/livekit.ts`

- [ ] **Step 1: Write the LiveKit client**

```typescript
// src/livekit.ts
import {
  RoomServiceClient,
  SipClient,
  EgressClient,
} from "livekit-server-sdk";

const {
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
} = process.env;

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error("Missing LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET");
  process.exit(1);
}

// HTTPS URL for API calls (strip wss:// prefix)
const httpUrl = LIVEKIT_URL.replace("wss://", "https://");

export const roomService = new RoomServiceClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
export const sipClient = new SipClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
export const egressClient = new EgressClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/livekit.ts
git commit -m "feat: add LiveKit client module (room, SIP, egress)"
```

---

### Task 3: Simplify database schema

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/queries.ts`

- [ ] **Step 1: Rewrite schema — remove captureWords, captureTranscripts. Add egressId to captures.**

```typescript
// src/db/schema.ts
import {
  pgTable,
  text,
  varchar,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

// ── Captures (Phone-to-Phone Recording) ─────────────────────────────

export const captures = pgTable("captures", {
  id: varchar("id", { length: 12 }).primaryKey(),
  name: text("name").notNull(),
  phoneA: varchar("phone_a", { length: 20 }).notNull(),
  phoneB: varchar("phone_b", { length: 20 }).notNull(),
  language: varchar("language", { length: 10 }).notNull().default("en"),
  status: varchar("status", { length: 20 }).notNull().default("created"),
  roomName: varchar("room_name", { length: 100 }),
  egressId: varchar("egress_id", { length: 50 }),
  recordingUrl: text("recording_url"),
  localRecordingPath: text("local_recording_path"),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});
```

Note: We're dropping test_sessions, test_scripts, test_transcripts, capture_transcripts, capture_words. They'll come back later when we add LiveKit agents + offline ASR. For this migration, captures is the only table.

- [ ] **Step 2: Rewrite queries — capture CRUD only**

```typescript
// src/db/queries.ts
import { eq } from "drizzle-orm";
import { db } from "./index";
import * as schema from "./schema";

export async function createCapture(capture: typeof schema.captures.$inferInsert) {
  await db.insert(schema.captures).values(capture).onConflictDoNothing();
}

export async function updateCapture(id: string, fields: Partial<typeof schema.captures.$inferInsert>) {
  await db.update(schema.captures).set(fields).where(eq(schema.captures.id, id));
}

export async function getCapture(id: string) {
  return db.query.captures.findFirst({ where: eq(schema.captures.id, id) });
}

export async function listCaptures() {
  return db.query.captures.findMany({ orderBy: (t, { desc }) => [desc(t.createdAt)] });
}
```

- [ ] **Step 3: Push schema changes to DB**

```bash
DATABASE_URL=postgresql://hrushiborhade@localhost:5432/telephony npx drizzle-kit push
```

Expected: Schema applied, tables updated.

- [ ] **Step 4: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: Errors in `src/server.ts` (expected — we haven't rewritten it yet). No errors in `src/db/*`.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/queries.ts
git commit -m "feat: simplify schema to captures-only with egressId"
```

---

### Task 4: Rewrite audio.ts — recording downloader

**Files:**
- Modify: `src/audio.ts`

- [ ] **Step 1: Replace mulaw WAV writer with recording downloader**

```typescript
// src/audio.ts
import fs from "fs";
import path from "path";

const RECORDINGS_DIR = path.join(process.cwd(), "recordings");

if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

/**
 * Download a recording from a URL and save it locally.
 */
export async function downloadRecording(url: string, filename: string): Promise<string> {
  const filePath = path.join(RECORDINGS_DIR, filename);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download recording: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  console.log(`[AUDIO] Downloaded ${filename} (${(buffer.length / 1024).toFixed(1)}KB)`);
  return filePath;
}

export function getRecordingPath(filename: string): string {
  return path.join(RECORDINGS_DIR, filename);
}

export function recordingExists(filename: string): boolean {
  return fs.existsSync(path.join(RECORDINGS_DIR, filename));
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/audio.ts
git commit -m "feat: replace mulaw WAV writer with recording downloader"
```

---

### Task 5: Rewrite types.ts

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Simplify to capture types only**

```typescript
// src/types.ts
export interface Capture {
  id: string;
  name: string;
  phoneA: string;
  phoneB: string;
  language: string;
  status: "created" | "calling" | "active" | "ended" | "recording" | "completed";
  roomName?: string;
  egressId?: string;
  recordingUrl?: string;
  localRecordingPath?: string;
  durationSeconds?: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: simplify types to capture-only"
```

---

### Task 6: Rewrite server.ts — the core migration

**Files:**
- Modify: `src/server.ts`

This is the biggest task. The new server is MUCH simpler — no WebSocket servers, no TwiML, no Deepgram, no media streams.

- [ ] **Step 1: Write the new server**

```typescript
// src/server.ts
import "dotenv/config";
import express from "express";
import crypto from "crypto";
import { roomService, sipClient, egressClient } from "./livekit";
import * as dbq from "./db/queries";
import { downloadRecording } from "./audio";
import type { Capture } from "./types";
import {
  EncodedFileOutput,
  EncodedFileType,
} from "livekit-server-sdk";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  next();
});

const {
  LIVEKIT_SIP_TRUNK_ID,
  TELNYX_PHONE_NUMBER,
  PORT = "3001",
} = process.env;

if (!LIVEKIT_SIP_TRUNK_ID) {
  console.error("Missing LIVEKIT_SIP_TRUNK_ID");
  process.exit(1);
}

// In-memory cache for active captures
const activeCaptures = new Map<string, Capture>();

// Catch unhandled promise rejections
process.on("unhandledRejection", (reason: any) => {
  console.error("[UNHANDLED]", reason?.message ?? reason);
});

// ── API Routes ──────────────────────────────────────────────────────

// List captures
app.get("/api/captures", async (_req, res) => {
  const rows = await dbq.listCaptures();
  res.json(rows);
});

// Get capture detail
app.get("/api/captures/:id", async (req, res) => {
  const cached = activeCaptures.get(req.params.id);
  if (cached) { res.json(cached); return; }

  const row = await dbq.getCapture(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// Create capture
app.post("/api/captures", async (req, res) => {
  const { name, phoneA, phoneB, language } = req.body;
  if (!phoneA || !phoneB) {
    res.status(400).json({ error: "Need phoneA and phoneB" });
    return;
  }

  const id = crypto.randomBytes(6).toString("hex");
  const capture: Capture = {
    id,
    name: name || "Untitled",
    phoneA,
    phoneB,
    language: language || "en",
    status: "created",
    roomName: `capture-${id}`,
    createdAt: new Date().toISOString(),
  };

  activeCaptures.set(id, capture);
  await dbq.createCapture({
    id,
    name: capture.name,
    phoneA,
    phoneB,
    language: capture.language,
    status: "created",
    roomName: capture.roomName!,
  });

  console.log(`[CAPTURE] Created: ${id}`);
  res.json(capture);
});

// Start capture — create room, dial both phones, start recording
app.post("/api/captures/:id/start", async (req, res) => {
  const capture = activeCaptures.get(req.params.id);
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }
  if (capture.status !== "created") {
    res.status(400).json({ error: `Status is ${capture.status}` }); return;
  }

  capture.status = "calling";
  capture.startedAt = new Date().toISOString();

  try {
    // Step 1: Create LiveKit room with auto-egress (records all tracks)
    await roomService.createRoom({
      name: capture.roomName!,
      emptyTimeout: 300,
      maxParticipants: 4,
    });
    console.log(`[CAPTURE] Room created: ${capture.roomName}`);

    // Step 2: Start room composite egress (audio-only, dual-channel)
    const fileOutput = new EncodedFileOutput({
      fileType: EncodedFileType.OGG,
      filepath: `recordings/${capture.id}-mixed.ogg`,
    });

    const egressInfo = await egressClient.startRoomCompositeEgress(
      capture.roomName!,
      { file: fileOutput },
      { audioOnly: true },
    );
    capture.egressId = egressInfo.egressId;
    console.log(`[CAPTURE] Egress started: ${egressInfo.egressId}`);

    // Step 3: Dial Phone A into the room
    const participantA = await sipClient.createSipParticipant(
      LIVEKIT_SIP_TRUNK_ID!,
      capture.phoneA,
      capture.roomName!,
      {
        participantIdentity: "caller_a",
        participantName: "Phone A",
        krispEnabled: true,
        waitUntilAnswered: true,
      },
    );
    console.log(`[CAPTURE] Phone A connected: ${capture.phoneA}`);

    // Step 4: Dial Phone B (staggered)
    await new Promise((r) => setTimeout(r, 2000));

    const participantB = await sipClient.createSipParticipant(
      LIVEKIT_SIP_TRUNK_ID!,
      capture.phoneB,
      capture.roomName!,
      {
        participantIdentity: "caller_b",
        participantName: "Phone B",
        krispEnabled: true,
        waitUntilAnswered: true,
      },
    );
    console.log(`[CAPTURE] Phone B connected: ${capture.phoneB}`);

    capture.status = "active";
    dbq.updateCapture(capture.id, {
      status: "active",
      startedAt: new Date(capture.startedAt),
      egressId: capture.egressId,
    });

    res.json({
      roomName: capture.roomName,
      egressId: capture.egressId,
    });
  } catch (err: any) {
    capture.status = "created";
    capture.startedAt = undefined;
    console.error("[CAPTURE] Start failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// End capture — close room, egress auto-stops, download recording
app.post("/api/captures/:id/end", async (req, res) => {
  const capture = activeCaptures.get(req.params.id);
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }

  try {
    // Delete the room — this disconnects all participants and stops egress
    await roomService.deleteRoom(capture.roomName!);
    console.log(`[CAPTURE] Room deleted: ${capture.roomName}`);

    capture.status = "ended";
    capture.endedAt = new Date().toISOString();

    const duration = capture.startedAt
      ? Math.round((Date.now() - new Date(capture.startedAt).getTime()) / 1000)
      : 0;
    capture.durationSeconds = duration;

    dbq.updateCapture(capture.id, {
      status: "ended",
      endedAt: new Date(capture.endedAt),
      durationSeconds: duration,
    });

    res.json({ status: "ended", durationSeconds: duration });
  } catch (err: any) {
    console.error("[CAPTURE] End failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve local recordings
app.get("/api/recordings/:filename", (req, res) => {
  const { getRecordingPath, recordingExists } = require("./audio");
  const filename = req.params.filename;
  if (!recordingExists(filename)) {
    res.status(404).json({ error: "Not found" }); return;
  }
  res.sendFile(getRecordingPath(filename));
});

// Health
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    activeCaptures: activeCaptures.size,
  });
});

// ── Start ───────────────────────────────────────────────────────────

app.listen(Number(PORT), () => {
  console.log(`
  Voice Agent Testing Platform — Backend (LiveKit + Telnyx)
  HTTP: http://localhost:${PORT}
  `);
});
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS

- [ ] **Step 3: Verify server starts**

```bash
npx tsx src/server.ts &
sleep 3
curl -s http://localhost:3001/health
kill %1
```

Expected: `{"status":"ok","activeCaptures":0}`

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: rewrite server with LiveKit + Telnyx (no Twilio/Deepgram)"
```

---

### Task 7: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace credentials**

```env
# Telnyx
TELNYX_PHONE_NUMBER=+1xxxxxxxxxx

# LiveKit Cloud
LIVEKIT_URL=wss://your-app.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxx
LIVEKIT_SIP_TRUNK_ID=ST_xxxxxxxxxxxxx

# PostgreSQL
DATABASE_URL=postgresql://user@localhost:5432/telephony

# Server
PORT=3001
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: update env template for Telnyx + LiveKit"
```

---

### Task 8: Simplify frontend types

**Files:**
- Modify: `web/src/lib/types.ts`
- Delete: `web/src/lib/use-session-socket.ts`

- [ ] **Step 1: Rewrite frontend types**

```typescript
// web/src/lib/types.ts
export interface Capture {
  id: string;
  name: string;
  phoneA: string;
  phoneB: string;
  language: string;
  status: "created" | "calling" | "active" | "ended" | "recording" | "completed";
  roomName?: string;
  recordingUrl?: string;
  localRecordingPath?: string;
  durationSeconds?: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}
```

- [ ] **Step 2: Delete WebSocket hook**

```bash
rm web/src/lib/use-session-socket.ts
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/types.ts
git rm web/src/lib/use-session-socket.ts
git commit -m "feat: simplify frontend types, remove WebSocket hook"
```

---

### Task 9: Rewrite capture dashboard page

**Files:**
- Modify: `web/src/app/capture/page.tsx`

- [ ] **Step 1: Update to use simplified types and poll-based status**

The page stays mostly the same — create captures, list them, click to open. Remove any WebSocket references. Keep the table, dialog, and navigation. Replace `CaptureSummary` type with `Capture` type directly (the list endpoint now returns full capture objects from DB).

Key changes:
- Import `Capture` instead of `CaptureSummary`
- Add `durationSeconds` display in the table
- No other structural changes needed

- [ ] **Step 2: Verify typecheck**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/capture/page.tsx
git commit -m "feat: update capture dashboard for new types"
```

---

### Task 10: Rewrite capture detail page

**Files:**
- Modify: `web/src/app/capture/[id]/page.tsx`
- Delete: `web/src/app/capture/[id]/review/page.tsx`
- Delete: `web/src/app/session/[id]/page.tsx`

- [ ] **Step 1: Rewrite capture detail — no WebSocket, no live transcript, just status + recording**

The page becomes simpler:
- Fetch capture data on mount
- Poll `/api/captures/:id` every 3 seconds for status updates
- Show: status badge, phone numbers, duration
- Start Call / End Call buttons
- After call ends: audio player for the recording
- Export button

Remove all `useSessionSocket` references, transcript panel, script prompter.

- [ ] **Step 2: Delete review page and session page**

```bash
rm -rf web/src/app/capture/\[id\]/review
rm -rf web/src/app/session
```

- [ ] **Step 3: Update main dashboard to remove session references**

In `web/src/app/page.tsx`, remove the "Agent Testing" session table and redirect straight to `/capture`.

- [ ] **Step 4: Verify build**

```bash
cd web && npx next build
```

Expected: All routes build. No `/session/[id]` or `/capture/[id]/review` routes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: simplify frontend to capture-only with polling status"
```

---

### Task 11: Delete unused files and clean up

**Files:**
- Delete: `drizzle/` (regenerate fresh)
- Modify: `package.json` scripts

- [ ] **Step 1: Remove old drizzle migrations**

```bash
rm -rf drizzle/
```

- [ ] **Step 2: Generate fresh migration**

```bash
DATABASE_URL=postgresql://hrushiborhade@localhost:5432/telephony npx drizzle-kit generate
```

- [ ] **Step 3: Update package.json scripts**

Remove the `dev:backend & dev:frontend` combined script (was causing port conflicts). Keep separate scripts.

- [ ] **Step 4: Final typecheck + build**

```bash
npx tsc --noEmit
cd web && npx tsc --noEmit && npx next build
```

Expected: Both PASS. Routes: `/`, `/capture`, `/capture/[id]`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: clean up unused files, regenerate migration"
```

---

### Task 12: End-to-end test

- [ ] **Step 1: Push DB schema**

```bash
DATABASE_URL=postgresql://hrushiborhade@localhost:5432/telephony npx drizzle-kit push
```

- [ ] **Step 2: Start backend**

```bash
npx tsx src/server.ts
```

- [ ] **Step 3: Start frontend**

```bash
cd web && npx next dev -p 3000
```

- [ ] **Step 4: Test API endpoints**

```bash
# Health
curl http://localhost:3001/health

# Create capture
curl -X POST http://localhost:3001/api/captures \
  -H "Content-Type: application/json" \
  -d '{"name":"Migration Test","phoneA":"+917887718721","phoneB":"+917070720110","language":"en"}'

# List captures
curl http://localhost:3001/api/captures
```

- [ ] **Step 5: Test live call (if SIP trunk is configured)**

1. Open http://localhost:3000/capture
2. Create capture → Start Call
3. Both phones ring → answer → press 1 (if Telnyx trial)
4. Talk for 30 seconds
5. End Call
6. Verify recording appears

- [ ] **Step 6: Verify DB**

```bash
psql -d telephony -c "SELECT id, name, status, duration_seconds, recording_url IS NOT NULL as has_recording FROM captures"
```

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "test: verify end-to-end migration works"
git push origin main
```

---

## Summary

| Metric | Before (Twilio) | After (LiveKit + Telnyx) |
|--------|-----------------|--------------------------|
| `server.ts` lines | ~1,200 | ~200 |
| WebSocket servers | 2 (media + client) | 0 |
| TwiML endpoints | 4 | 0 |
| External SDKs | 3 (twilio, @deepgram/sdk, ws) | 1 (livekit-server-sdk) |
| DB tables | 6 | 1 |
| Frontend pages | 6 | 3 |
| Real-time ASR | Yes (complex) | No (offline later) |
| Recording | Twilio conference (mono) | LiveKit egress (configurable) |
