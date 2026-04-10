# Audio Post-Processing Pipeline — Implementation Plan

> Switch from Deepgram to Gemini STT, restructure S3 storage, add CSV export for SOTA Labs, BullMQ for durability.

---

## Critical: Rotate Your Gemini API Key

The Gemini API key was previously exposed in this file. **It has been rotated.** Generate a new key at https://aistudio.google.com/apikey.

---

## Why Gemini Instead of Deepgram

| Feature | Deepgram Nova-3 | Gemini 3 Flash |
|---------|-----------------|----------------|
| **Timestamp granularity** | Word-level + utterance-level | Segment-level (MM:SS format) |
| **Structured output** | Fixed JSON schema | Custom JSON schema (you define the shape) |
| **Emotion detection** | No | Yes (happy/sad/angry/neutral per segment) |
| **Language detection** | Auto-detect | Auto-detect + translation |
| **Cost** | $0.0043/min (Nova-3) | Free tier generous, then $0.10/1M tokens |
| **Max audio length** | Unlimited (streaming) | 9.5 hours per request |
| **SDK** | REST API | `@google/genai` (official TypeScript SDK) |

**Key difference:** Gemini returns timestamps as `MM:SS` strings in a custom schema you define. Deepgram returns precise float seconds. For utterance slicing, we need to parse Gemini's `MM:SS` to seconds for ffmpeg.

**Limitation:** Gemini doesn't provide word-level timestamps or confidence scores per word. For our use case (utterance-level slicing), this is fine — we need segment boundaries, not word boundaries.

---

## S3 Storage Structure

### Current (Flat, Messy)

```
s3://telephony-recordings/
├── recordings/abc123-mixed.mp4
├── recordings/abc123-caller_a.mp4
├── recordings/abc123-caller_b.mp4
├── utterances/abc123-caller_a-utt-0.mp4
├── utterances/abc123-caller_a-utt-1.mp4
└── ...
```

### Proposed (Organized by Capture)

```
s3://telephony-recordings/
└── captures/
    └── {captureId}/
        ├── mixed.mp3                          # Full call (both participants)
        ├── participant-a/
        │   ├── full.mp3                       # Participant A full track
        │   └── clips/
        │       ├── 000-00m05s-00m08s.mp3      # Utterance 0: 0:05 → 0:08
        │       ├── 001-00m12s-00m15s.mp3      # Utterance 1: 0:12 → 0:15
        │       └── ...
        ├── participant-b/
        │   ├── full.mp3                       # Participant B full track
        │   └── clips/
        │       ├── 000-00m03s-00m07s.mp3
        │       ├── 001-00m09s-00m14s.mp3
        │       └── ...
        ├── transcript.json                     # Full structured transcript
        └── dataset.csv                         # SOTA Labs export
```

**File naming convention:** `{index}-{startTime}-{endTime}.mp3`
- `000-00m05s-00m08s.mp3` = utterance #0, starts at 0:05, ends at 0:08
- Human-readable, sortable, self-documenting

---

## CSV Export for SOTA Labs

### Format

```csv
utterance_text,audio_clip_url,timestamp_start,timestamp_end,participant,participant_track_url,emotion,language,capture_id
"Hello how are you",https://s3.../captures/abc123/participant-a/clips/000-00m05s-00m08s.mp3,00:05,00:08,participant_a,https://s3.../captures/abc123/participant-a/full.mp3,neutral,en,abc123
"I'm calling about the order",https://s3.../captures/abc123/participant-a/clips/001-00m12s-00m15s.mp3,00:12,00:15,participant_a,https://s3.../captures/abc123/participant-a/full.mp3,neutral,en,abc123
"Yes let me check that",https://s3.../captures/abc123/participant-b/clips/000-00m09s-00m14s.mp3,00:09,00:14,participant_b,https://s3.../captures/abc123/participant-b/full.mp3,happy,en,abc123
```

### Columns

| # | Column | Description | Example |
|---|--------|-------------|---------|
| 1 | `utterance_text` | Transcribed text of this segment | "Hello how are you" |
| 2 | `audio_clip_url` | S3 URL of the sliced MP3 clip | `https://s3.../clips/000-00m05s.mp3` |
| 3 | `timestamp_start` | Start time in participant's track (MM:SS) | 00:05 |
| 4 | `timestamp_end` | End time in participant's track (MM:SS) | 00:08 |
| 5 | `participant` | Which caller | participant_a / participant_b |
| 6 | `participant_track_url` | Full audio track URL for this participant | `https://s3.../participant-a/full.mp3` |
| 7 | `emotion` | Gemini-detected emotion | happy/sad/angry/neutral |
| 8 | `language` | Detected language code | en/hi/es |
| 9 | `capture_id` | Unique capture identifier | abc123 |

---

## Complete Pipeline Flow

```
1. WEBHOOK (egress_ended) — fires 3× per capture (mixed, caller_a, caller_b)
   │
   │  For each recording, webhook updates the DB with the S3 URL.
   │  When ALL 3 recordings are ready (mixed + caller_a + caller_b):
   │
   ▼
2. ENQUEUE JOB
   │
   │  audioQueue.add('process-capture', {
   │    captureId: 'abc123',
   │    mixedUrl: 'https://s3.../recordings/abc123-mixed.mp4',
   │    callerAUrl: 'https://s3.../recordings/abc123-caller_a.mp4',
   │    callerBUrl: 'https://s3.../recordings/abc123-caller_b.mp4',
   │  })
   │
   ▼
3. WORKER PICKS UP JOB
   │
   ├── Step 1: DOWNLOAD all 3 recordings to /tmp
   │   └── fetch() each URL → write to disk
   │
   ├── Step 2: CONVERT to MP3
   │   ├── ffmpeg mixed.mp4 → mixed.mp3 (libmp3lame, 16kHz, mono)
   │   ├── ffmpeg caller_a.mp4 → participant-a-full.mp3
   │   └── ffmpeg caller_b.mp4 → participant-b-full.mp3
   │
   ├── Step 3: UPLOAD full tracks to structured S3 paths
   │   ├── captures/{id}/mixed.mp3
   │   ├── captures/{id}/participant-a/full.mp3
   │   └── captures/{id}/participant-b/full.mp3
   │
   ├── Step 4: TRANSCRIBE with Gemini (both participants)
   │   │
   │   │  For each participant track:
   │   │  Upload audio to Gemini Files API (if > 20MB)
   │   │  OR send inline (if < 20MB)
   │   │
   │   │  Prompt: "Transcribe this audio with timestamps (SS.ms format),
   │   │           detect language and emotion per segment"
   │   │
   │   │  Response schema enforces structured output:
   │   │  { segments: [{ startSeconds, endSeconds, content, language, emotion }] }
   │   │
   │   └── Returns: utterances[] for participant A, utterances[] for participant B
   │
   ├── Step 5: SLICE utterances to MP3 clips (parallel, batches of 10)
   │   │
   │   │  For each utterance:
   │   │    ffmpeg -y -i full.mp3 -ss {start} -t {duration} -c:a libmp3lame \
   │   │           -q:a 5 -ar 16000 -ac 1 clip.mp3
   │   │
   │   └── Returns: array of { ...utterance, localClipPath, s3Key }
   │
   ├── Step 6: UPLOAD clips to S3 (parallel, batches of 10)
   │   ├── captures/{id}/participant-a/clips/000-00m05s-00m08s.mp3
   │   ├── captures/{id}/participant-a/clips/001-00m12s-00m15s.mp3
   │   ├── captures/{id}/participant-b/clips/000-00m03s-00m07s.mp3
   │   └── ...
   │
   ├── Step 7: GENERATE CSV
   │   │
   │   │  Combine all utterances from both participants
   │   │  Sort by absolute timestamp (or keep per-participant order)
   │   │  Write CSV string with headers
   │   │  Upload to: captures/{id}/dataset.csv
   │   │
   │   └── Also save transcript.json with full structured data
   │
   └── Step 8: UPDATE DB
       ├── transcriptA = JSON (participant A utterances with clip URLs)
       ├── transcriptB = JSON (participant B utterances with clip URLs)
       ├── recordingUrl = captures/{id}/mixed.mp3
       ├── recordingUrlA = captures/{id}/participant-a/full.mp3
       ├── recordingUrlB = captures/{id}/participant-b/full.mp3
       ├── datasetCsvUrl = captures/{id}/dataset.csv
       └── status = "completed"
```

---

## Gemini Integration Details

### SDK: `@google/genai`

```typescript
import { GoogleGenAI, Type } from '@google/genai';

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
```

### Transcription with Structured Output

```typescript
async function transcribeWithGemini(audioBuffer: Buffer, mimeType: string): Promise<Segment[]> {
  // For files < 20MB, send inline
  const response = await genai.models.generateContent({
    model: 'gemini-2.5-flash',  // Latest stable, fast, cheap
    contents: {
      parts: [
        {
          inlineData: {
            data: audioBuffer.toString('base64'),
            mimeType,
          },
        },
        {
          text: `Transcribe this audio recording precisely.

Requirements:
1. Return EVERY utterance/segment with accurate start and end times in SECONDS (decimal, e.g. 5.2).
2. Detect the language of each segment.
3. Detect the primary emotion: happy, sad, angry, or neutral.
4. Be thorough — do not skip any speech, even short utterances.
5. Use the exact words spoken, no paraphrasing.`,
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startSeconds: { type: Type.NUMBER },
                endSeconds: { type: Type.NUMBER },
                content: { type: Type.STRING },
                language: { type: Type.STRING },
                emotion: {
                  type: Type.STRING,
                  enum: ['happy', 'sad', 'angry', 'neutral'],
                },
              },
              required: ['startSeconds', 'endSeconds', 'content', 'language', 'emotion'],
            },
          },
        },
        required: ['segments'],
      },
    },
  });

  const result = JSON.parse(response.text);
  return result.segments;
}
```

**Why `startSeconds`/`endSeconds` as NUMBER instead of MM:SS string?**
- ffmpeg needs seconds: `ffmpeg -ss 5.2 -t 3.1`
- Avoids parsing MM:SS strings and potential format inconsistency
- Gemini's structured output enforces the NUMBER type

**Why `gemini-2.5-flash`?**
- Cheapest Gemini model with audio understanding
- Structured output (JSON schema) support
- Fast enough for batch processing
- Free tier: 1500 requests/day

### For Files > 20MB: Use Gemini Files API

```typescript
import { GoogleGenAI } from '@google/genai';

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Upload large audio file first
const uploadResult = await genai.files.upload({
  file: audioBuffer,
  config: { mimeType: 'audio/mp3' },
});

// Then reference in generateContent
const response = await genai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: {
    parts: [
      { fileData: { fileUri: uploadResult.uri, mimeType: 'audio/mp3' } },
      { text: '...' },
    ],
  },
  config: { ... },
});
```

---

## Environment Variables

### New Variables

| Variable | Where | Value |
|----------|-------|-------|
| `GEMINI_API_KEY` | Secrets Manager + .env | `AIzaSy...` (ROTATE THIS) |
| `REDIS_HOST` | docker-compose + Secrets Manager | `localhost` (dev) / ElastiCache endpoint (prod) |
| `REDIS_PORT` | docker-compose + env | `6379` |

### Variables to Remove

| Variable | Why |
|----------|-----|
| `DEEPGRAM_API_KEY` | Replaced by Gemini |

### Update env.ts Schema

```typescript
// Add:
GEMINI_API_KEY: z.string().min(1).optional(),
REDIS_HOST: z.string().default('localhost'),
REDIS_PORT: z.coerce.number().default(6379),

// Remove:
// DEEPGRAM_API_KEY (no longer needed)
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `apps/workers/package.json` | Worker package with BullMQ, @google/genai, ffmpeg deps |
| `apps/workers/Dockerfile` | node:22-alpine + ffmpeg |
| `apps/workers/src/worker.ts` | BullMQ worker entry point |
| `apps/workers/src/queues.ts` | Queue definitions (shared) |
| `apps/workers/src/processors/audio.ts` | Audio pipeline: download → convert → transcribe → slice → upload → CSV → save |
| `apps/workers/src/lib/gemini.ts` | Gemini STT client |
| `apps/workers/src/lib/ffmpeg.ts` | ffmpeg helpers (convert, slice) |
| `apps/workers/src/lib/s3.ts` | S3 upload helpers |
| `apps/workers/src/lib/csv.ts` | CSV generation |
| `packages/queues/package.json` | Shared queue definitions (used by API + worker) |
| `packages/queues/src/index.ts` | Queue instances + connection config |

## Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/env.ts` | Add GEMINI_API_KEY, REDIS_HOST/PORT; remove DEEPGRAM_API_KEY |
| `apps/api/src/routes/webhooks.ts` | Replace inline transcription with queue.add(); trigger job when all 3 recordings are ready |
| `apps/api/package.json` | Add `bullmq` dependency |
| `.env` | Add GEMINI_API_KEY, REDIS_HOST |
| `.env.example` | Update with new variables |
| `docker-compose.dev.yml` | Add Redis service |
| `pnpm-workspace.yaml` | Verify `packages/*` includes the new queues package |

## Files to Delete

| File | Why |
|------|-----|
| `apps/api/src/services/transcription.ts` | Replaced by worker pipeline |

---

## Implementation Steps (In Order)

### Step 1: Environment Setup
- Add `GEMINI_API_KEY` to `.env` and `.env.example`
- Add `REDIS_HOST`, `REDIS_PORT` to `.env`
- Update `env.ts` Zod schema
- Add Redis to `docker-compose.dev.yml`

### Step 2: Create Shared Queues Package
- Create `packages/queues/`
- Define `audioQueue` with BullMQ
- Export connection config and queue instances

### Step 3: Create Worker Package
- Create `apps/workers/` with package.json, tsconfig, Dockerfile
- Install: `bullmq`, `@google/genai`, `@repo/db`, `@repo/queues`
- Implement `worker.ts` entry point

### Step 4: Implement Audio Processor
- `lib/gemini.ts` — Gemini STT with structured output
- `lib/ffmpeg.ts` — Convert MP4→MP3, slice by timestamp
- `lib/s3.ts` — Upload to structured S3 paths
- `lib/csv.ts` — Generate dataset CSV
- `processors/audio.ts` — Orchestrate the full pipeline

### Step 5: Update API Webhook Handler
- Modify `webhooks.ts` to enqueue job instead of inline processing
- Track when all 3 recordings are ready before enqueueing
- Remove old `transcription.ts` service

### Step 6: Test Locally
- `docker-compose up` (postgres + redis)
- Run API (`pnpm dev:api`)
- Run worker (`cd apps/workers && tsx src/worker.ts`)
- Trigger a capture → verify S3 structure, CSV, transcript

### Step 7: Build & Verify Docker
- Build worker Dockerfile (must include ffmpeg)
- Verify worker container starts and connects to Redis

### Step 8: Update Terraform
- Add ElastiCache Redis
- Add worker ECS service
- Add worker ECR repository
- Update Secrets Manager with GEMINI_API_KEY

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Gemini timestamp accuracy | Validate segments: endSeconds > startSeconds, no overlaps. Fall back to Deepgram if Gemini timestamps are unreliable. |
| Gemini rate limits (free tier) | BullMQ rate limiter: max 10 jobs/min. Upgrade to paid if needed. |
| Large audio files (> 20MB) | Use Gemini Files API for upload, then reference URI. |
| ffmpeg not in worker container | Dockerfile: `apk add --no-cache ffmpeg` — verified in build. |
| Redis connection loss | BullMQ auto-reconnects. Jobs in Redis survive. |
| S3 upload failures | BullMQ retries 3× with exponential backoff. |
| CSV encoding issues | Use `csv-stringify` library for proper escaping. |

---

## Estimated Timeline

| Step | Effort |
|------|--------|
| Steps 1-2 (env + queues) | 15 min |
| Step 3 (worker scaffold) | 15 min |
| Step 4 (audio processor) | 45 min |
| Step 5 (webhook update) | 15 min |
| Step 6 (local testing) | 20 min |
| Step 7 (Docker verify) | 10 min |
| **Total** | **~2 hours** |
