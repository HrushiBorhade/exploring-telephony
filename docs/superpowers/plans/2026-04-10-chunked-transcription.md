# Chunked Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the audio transcription pipeline handle 30-minute tracks without timestamp degradation by chunking audio into 10-minute segments with 15-second overlaps, transcribing each chunk, and merging results.

**Architecture:** All chunking logic lives inside `transcribeWithGemini`. Callers see no change — they pass audio + duration, get back `Segment[]`. For audio ≤ 10 min, the current single-call path is used unchanged. For audio > 10 min, ffmpeg splits into overlapping chunks, Gemini transcribes each chunk (with concurrency limit to avoid rate limits), and a merge step offsets timestamps and deduplicates the overlap region. The Deepgram fallback applies per-chunk, not per-track.

**Tech Stack:** ffmpeg (chunking via `-ss`/`-t`), Gemini 3.1 Pro (transcription), vitest (testing), BullMQ (unchanged)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/workers/src/lib/gemini.ts` | Modify | Add `transcribeChunked` orchestrator, keep `_transcribeGemini` as the single-chunk workhorse |
| `apps/workers/src/lib/ffmpeg.ts` | Modify | Add `splitIntoChunks` function |
| `apps/workers/tests/gemini-chunking.test.ts` | Create | Unit tests for chunk splitting, timestamp offsetting, overlap deduplication |
| `apps/workers/tests/ffmpeg.test.ts` | Modify | Add test for `splitIntoChunks` |

No changes to `audio.ts`, `csv.ts`, `worker.ts`, or any other file. The chunking is fully encapsulated.

---

### Task 1: Add `splitIntoChunks` to ffmpeg.ts

**Files:**
- Modify: `apps/workers/src/lib/ffmpeg.ts`
- Modify: `apps/workers/tests/ffmpeg.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/workers/tests/ffmpeg.test.ts`:

```typescript
describe("splitIntoChunks", () => {
  it("returns single chunk for short audio (< chunkDuration)", async () => {
    const wavPath = path.join(tmpDir, "short.wav");
    await createTestWav(wavPath, 30); // 30 seconds

    const chunks = await splitIntoChunks(wavPath, tmpDir, {
      chunkDuration: 600,
      overlapDuration: 15,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].offsetSeconds).toBe(0);
    expect(chunks[0].filePath).toBe(wavPath); // no splitting needed, returns original
  });

  it("splits long audio into overlapping chunks", async () => {
    const wavPath = path.join(tmpDir, "long.wav");
    await createTestWav(wavPath, 65); // 65 seconds

    const chunks = await splitIntoChunks(wavPath, tmpDir, {
      chunkDuration: 30,
      overlapDuration: 5,
    });

    // 65s with 30s chunks and 5s overlap:
    // chunk 0: 0-30s (offset 0)
    // chunk 1: 25-55s (offset 25)
    // chunk 2: 50-65s (offset 50)
    expect(chunks).toHaveLength(3);
    expect(chunks[0].offsetSeconds).toBe(0);
    expect(chunks[1].offsetSeconds).toBe(25);
    expect(chunks[2].offsetSeconds).toBe(50);

    // Each chunk file should exist and have audio data
    for (const chunk of chunks) {
      const data = await readFile(chunk.filePath);
      expect(data.length).toBeGreaterThan(0);
    }
  });

  it("handles audio exactly at chunk boundary", async () => {
    const wavPath = path.join(tmpDir, "exact.wav");
    await createTestWav(wavPath, 30);

    const chunks = await splitIntoChunks(wavPath, tmpDir, {
      chunkDuration: 30,
      overlapDuration: 5,
    });

    expect(chunks).toHaveLength(1);
  });
});
```

Import `splitIntoChunks` at the top of the test file alongside existing imports:
```typescript
import { convertToMp3, sliceToMp3, formatTimestamp, splitIntoChunks } from "../src/lib/ffmpeg";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/workers && pnpm test -- --reporter verbose tests/ffmpeg.test.ts`
Expected: FAIL — `splitIntoChunks` is not exported from ffmpeg.ts

- [ ] **Step 3: Implement `splitIntoChunks`**

Add to `apps/workers/src/lib/ffmpeg.ts`:

```typescript
export interface AudioChunk {
  filePath: string;
  offsetSeconds: number;
  durationSeconds: number;
}

export interface ChunkOptions {
  chunkDuration: number;   // seconds per chunk (default: 600 = 10 min)
  overlapDuration: number; // seconds of overlap between chunks (default: 15)
}

/**
 * Split audio into overlapping chunks for transcription.
 * Returns the original file as a single chunk if it's shorter than chunkDuration.
 * Each chunk's offsetSeconds is the position of its start in the original file.
 */
export async function splitIntoChunks(
  input: string,
  outputDir: string,
  opts: ChunkOptions,
): Promise<AudioChunk[]> {
  const totalDuration = await getDuration(input);

  if (totalDuration <= opts.chunkDuration) {
    return [{ filePath: input, offsetSeconds: 0, durationSeconds: totalDuration }];
  }

  const step = opts.chunkDuration - opts.overlapDuration;
  const chunks: AudioChunk[] = [];

  for (let offset = 0; offset < totalDuration; offset += step) {
    const remaining = totalDuration - offset;
    const chunkLen = Math.min(opts.chunkDuration, remaining);

    // Skip tiny trailing chunks (< 2s) — not enough audio for meaningful transcription
    if (chunkLen < 2) break;

    const chunkPath = path.join(outputDir, `chunk-${chunks.length}.mp3`);
    await run("ffmpeg", [
      "-y", "-i", input, "-ss", String(offset), "-t", String(chunkLen), ...MP3_OPTS, chunkPath,
    ]);

    chunks.push({ filePath: chunkPath, offsetSeconds: offset, durationSeconds: chunkLen });
  }

  return chunks;
}
```

Add `import path from "path";` at the top of ffmpeg.ts if not already present.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/workers && pnpm test -- --reporter verbose tests/ffmpeg.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/workers/src/lib/ffmpeg.ts apps/workers/tests/ffmpeg.test.ts
git commit -m "feat(workers): add splitIntoChunks for audio chunking"
```

---

### Task 2: Add chunk merging logic and wire into `transcribeWithGemini`

**Files:**
- Modify: `apps/workers/src/lib/gemini.ts`
- Create: `apps/workers/tests/gemini-chunking.test.ts`

- [ ] **Step 1: Write the failing tests for merge logic**

Create `apps/workers/tests/gemini-chunking.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mergeChunkSegments } from "../src/lib/gemini";
import type { Segment } from "../src/lib/gemini";

describe("mergeChunkSegments", () => {
  it("returns segments unchanged for a single chunk", () => {
    const chunkResults = [
      {
        offsetSeconds: 0,
        durationSeconds: 60,
        segments: [
          { startSeconds: 2, endSeconds: 5, content: "hello", language: "en", emotion: "neutral" as const },
          { startSeconds: 10, endSeconds: 15, content: "world", language: "en", emotion: "neutral" as const },
        ],
      },
    ];

    const merged = mergeChunkSegments(chunkResults);
    expect(merged).toHaveLength(2);
    expect(merged[0].startSeconds).toBe(2);
    expect(merged[1].startSeconds).toBe(10);
  });

  it("offsets timestamps by chunk offset", () => {
    const chunkResults = [
      {
        offsetSeconds: 0,
        durationSeconds: 30,
        segments: [
          { startSeconds: 5, endSeconds: 10, content: "first chunk", language: "en", emotion: "neutral" as const },
        ],
      },
      {
        offsetSeconds: 25,
        durationSeconds: 30,
        segments: [
          { startSeconds: 8, endSeconds: 12, content: "second chunk", language: "en", emotion: "neutral" as const },
        ],
      },
    ];

    const merged = mergeChunkSegments(chunkResults);
    expect(merged[0].startSeconds).toBe(5);   // 0 + 5
    expect(merged[0].content).toBe("first chunk");
    expect(merged[1].startSeconds).toBe(33);  // 25 + 8
    expect(merged[1].content).toBe("second chunk");
  });

  it("deduplicates segments in overlap region", () => {
    // Chunk 0: 0-30s, chunk 1: 25-55s → overlap region is 25-30s
    const chunkResults = [
      {
        offsetSeconds: 0,
        durationSeconds: 30,
        segments: [
          { startSeconds: 5, endSeconds: 8, content: "early", language: "en", emotion: "neutral" as const },
          { startSeconds: 26, endSeconds: 29, content: "in overlap from chunk 0", language: "en", emotion: "neutral" as const },
        ],
      },
      {
        offsetSeconds: 25,
        durationSeconds: 30,
        segments: [
          { startSeconds: 1, endSeconds: 4, content: "in overlap from chunk 1", language: "en", emotion: "neutral" as const },
          { startSeconds: 10, endSeconds: 15, content: "after overlap", language: "en", emotion: "neutral" as const },
        ],
      },
    ];

    const merged = mergeChunkSegments(chunkResults);

    // "early" at 5s — before overlap, kept
    // "in overlap from chunk 0" at 26s — in overlap region, kept (chunk 0 owns it)
    // "in overlap from chunk 1" at 25+1=26s — in overlap region, dropped (duplicate)
    // "after overlap" at 25+10=35s — after overlap, kept
    expect(merged).toHaveLength(3);
    expect(merged[0].content).toBe("early");
    expect(merged[1].content).toBe("in overlap from chunk 0");
    expect(merged[2].content).toBe("after overlap");
    expect(merged[2].startSeconds).toBe(35);
  });

  it("sorts merged segments by startSeconds", () => {
    const chunkResults = [
      {
        offsetSeconds: 0,
        durationSeconds: 30,
        segments: [
          { startSeconds: 20, endSeconds: 25, content: "later", language: "en", emotion: "neutral" as const },
          { startSeconds: 2, endSeconds: 5, content: "earlier", language: "en", emotion: "neutral" as const },
        ],
      },
    ];

    const merged = mergeChunkSegments(chunkResults);
    expect(merged[0].content).toBe("earlier");
    expect(merged[1].content).toBe("later");
  });

  it("handles empty chunk results", () => {
    const chunkResults = [
      { offsetSeconds: 0, durationSeconds: 30, segments: [] },
      { offsetSeconds: 25, durationSeconds: 30, segments: [] },
    ];

    const merged = mergeChunkSegments(chunkResults);
    expect(merged).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/workers && pnpm test -- --reporter verbose tests/gemini-chunking.test.ts`
Expected: FAIL — `mergeChunkSegments` is not exported from gemini.ts

- [ ] **Step 3: Implement `mergeChunkSegments`**

Add to `apps/workers/src/lib/gemini.ts` (before the `_transcribeGemini` function):

```typescript
export interface ChunkTranscriptionResult {
  offsetSeconds: number;
  durationSeconds: number;
  segments: Segment[];
}

/**
 * Merge transcription results from overlapping audio chunks.
 *
 * Each chunk's segments have timestamps relative to the chunk start.
 * This function:
 * 1. Offsets each segment's timestamps by the chunk's position in the original file
 * 2. Deduplicates the overlap region: chunk N owns everything up to its end,
 *    chunk N+1 only contributes segments AFTER the overlap region
 * 3. Sorts all segments chronologically
 */
export function mergeChunkSegments(chunkResults: ChunkTranscriptionResult[]): Segment[] {
  if (chunkResults.length === 0) return [];
  if (chunkResults.length === 1) {
    return chunkResults[0].segments
      .map((s) => ({ ...s, startSeconds: s.startSeconds + chunkResults[0].offsetSeconds, endSeconds: s.endSeconds + chunkResults[0].offsetSeconds }))
      .sort((a, b) => a.startSeconds - b.startSeconds);
  }

  const allSegments: Segment[] = [];

  for (let i = 0; i < chunkResults.length; i++) {
    const chunk = chunkResults[i];
    const nextChunk = chunkResults[i + 1];

    // The overlap boundary: if there's a next chunk, its offset marks where
    // the overlap region starts. Chunk i owns everything below that boundary.
    // Chunk i+1 starts contributing from the boundary onwards.
    const overlapStart = nextChunk ? nextChunk.offsetSeconds : Infinity;

    for (const seg of chunk.segments) {
      const absoluteStart = seg.startSeconds + chunk.offsetSeconds;
      const absoluteEnd = seg.endSeconds + chunk.offsetSeconds;

      if (i === 0) {
        // First chunk: keep everything
        allSegments.push({ ...seg, startSeconds: absoluteStart, endSeconds: absoluteEnd });
      } else {
        // Subsequent chunks: only keep segments that START after the previous chunk's
        // ownership boundary (i.e., after this chunk's overlap region)
        const prevChunk = chunkResults[i - 1];
        const myOverlapEnd = prevChunk.offsetSeconds + prevChunk.durationSeconds;

        if (absoluteStart >= myOverlapEnd) {
          allSegments.push({ ...seg, startSeconds: absoluteStart, endSeconds: absoluteEnd });
        }
        // Segments starting inside the overlap region are dropped — the previous chunk owns them
      }
    }
  }

  return allSegments.sort((a, b) => a.startSeconds - b.startSeconds);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/workers && pnpm test -- --reporter verbose tests/gemini-chunking.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/workers/src/lib/gemini.ts apps/workers/tests/gemini-chunking.test.ts
git commit -m "feat(workers): add mergeChunkSegments for overlap deduplication"
```

---

### Task 3: Wire chunking into `transcribeWithGemini`

**Files:**
- Modify: `apps/workers/src/lib/gemini.ts`

- [ ] **Step 1: Add the chunked transcription orchestrator**

Modify `transcribeWithGemini` in `apps/workers/src/lib/gemini.ts`. Replace the existing function with:

```typescript
import { splitIntoChunks, type AudioChunk } from "./ffmpeg";
import { writeFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const CHUNK_DURATION = 600;   // 10 minutes
const OVERLAP_DURATION = 15;  // 15 seconds
const CHUNK_CONCURRENCY = 2;  // max parallel Gemini calls per track

/**
 * Transcribe audio with Gemini, falling back to Deepgram on 503/429 errors.
 * Automatically chunks audio longer than 10 minutes.
 */
export async function transcribeWithGemini(
  audioBuffer: Buffer,
  mimeType: string = "audio/mp3",
  audioDurationSeconds?: number,
): Promise<TranscriptionResult> {
  // Short audio: single call (current fast path)
  if (!audioDurationSeconds || audioDurationSeconds <= CHUNK_DURATION) {
    return _transcribeSingle(audioBuffer, mimeType, audioDurationSeconds);
  }

  // Long audio: chunk → transcribe each → merge
  logger.info({ durationSeconds: audioDurationSeconds }, "[GEMINI] Audio exceeds chunk threshold, splitting");

  const tmpDir = await mkdtemp(path.join(tmpdir(), "gemini-chunks-"));
  try {
    const inputPath = path.join(tmpDir, "input.mp3");
    await writeFile(inputPath, audioBuffer);

    const chunks = await splitIntoChunks(inputPath, tmpDir, {
      chunkDuration: CHUNK_DURATION,
      overlapDuration: OVERLAP_DURATION,
    });

    logger.info({ chunkCount: chunks.length }, "[GEMINI] Chunks created");

    // Transcribe chunks with limited concurrency to avoid rate limits
    const chunkResults: ChunkTranscriptionResult[] = [];

    for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
      const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (chunk) => {
          const chunkBuffer = await readFile(chunk.filePath);
          const result = await _transcribeSingle(chunkBuffer, mimeType, chunk.durationSeconds);
          return {
            offsetSeconds: chunk.offsetSeconds,
            durationSeconds: chunk.durationSeconds,
            segments: result.segments,
          };
        }),
      );
      chunkResults.push(...results);
    }

    const merged = mergeChunkSegments(chunkResults);
    logger.info({ totalSegments: merged.length, chunks: chunks.length }, "[GEMINI] Chunks merged");

    return { segments: merged };
  } finally {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  }
}

/**
 * Transcribe a single audio buffer (either a full short track or one chunk).
 * Falls back to Deepgram on 503/429.
 */
async function _transcribeSingle(
  audioBuffer: Buffer,
  mimeType: string,
  audioDurationSeconds?: number,
): Promise<TranscriptionResult> {
  try {
    return await _transcribeGemini(audioBuffer, mimeType, audioDurationSeconds);
  } catch (err: any) {
    const msg = err.message || "";
    const isOverloaded = msg.includes("503") || msg.includes("429") || msg.includes("UNAVAILABLE") || msg.includes("RESOURCE_EXHAUSTED");

    if (isOverloaded && process.env.DEEPGRAM_API_KEY) {
      logger.warn("[GEMINI] Unavailable, falling back to Deepgram");
      return transcribeWithDeepgram(audioBuffer, mimeType);
    }

    throw err;
  }
}
```

Add the `readFile` import at the top:
```typescript
import { writeFile, mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
```

Remove the old `transcribeWithGemini` function entirely — it's replaced by the new one above. The `_transcribeGemini` function (the actual Gemini API call) stays unchanged.

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `cd apps/workers && pnpm test -- --reporter verbose`
Expected: All existing tests PASS (ffmpeg, csv, gemini-chunking)

- [ ] **Step 3: Run typecheck**

Run: `cd apps/workers && cd ../.. && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/workers/src/lib/gemini.ts
git commit -m "feat(workers): auto-chunk long audio in transcribeWithGemini"
```

---

### Task 4: Integration test with real audio

**Files:**
- No file changes — manual verification

- [ ] **Step 1: Test with the 172s participant-a track**

The test audio is already at `tmp-test-2359/participant-a.mp3` (172s, under 10 min threshold). Run to verify the short-audio fast path still works:

```bash
GEMINI_API_KEY=$(grep GEMINI_API_KEY apps/workers/.env | cut -d= -f2) \
DEEPGRAM_API_KEY="" \
npx tsx tmp-test-2359/test-clean.ts
```

Expected: Same results as before — 15-20 segments, all clips OK, no regression.

- [ ] **Step 2: Test chunking path with forced low threshold**

Create a quick test script that forces chunking on the 172s file by setting CHUNK_DURATION to 60s:

```bash
GEMINI_API_KEY=$(grep GEMINI_API_KEY apps/workers/.env | cut -d= -f2) \
DEEPGRAM_API_KEY="" \
npx tsx -e "
import { readFile, mkdir } from 'fs/promises';
import path from 'path';
import { transcribeWithGemini } from './apps/workers/src/lib/gemini';
import { getDuration } from './apps/workers/src/lib/ffmpeg';

// Temporarily test with 60s chunks to force chunking on 172s file
// In production this would be 600s (10 min)
const track = 'tmp-test-2359/participant-a.mp3';
const dur = await getDuration(track);
console.log('Duration: ' + dur.toFixed(1) + 's');
console.log('This will chunk into ~3 pieces (60s each with 15s overlap)');

const result = await transcribeWithGemini(await readFile(track), 'audio/mp3', dur);
console.log('\nSegments: ' + result.segments.length);
for (const s of result.segments) {
  console.log('  ' + s.startSeconds.toFixed(1) + 's - ' + s.endSeconds.toFixed(1) + 's | ' + s.content.slice(0, 60));
}
"
```

To test the chunking path, temporarily change `CHUNK_DURATION` to 60 in gemini.ts, run the test, then revert it back to 600. Verify:
- Segments span the full 172s (first segment near 0s, last segment near 168s)
- No duplicate segments in the overlap regions
- Timestamps are monotonically increasing
- Total segment count is similar to the non-chunked result

- [ ] **Step 3: Revert CHUNK_DURATION to 600 if changed**

- [ ] **Step 4: Commit test results verification**

```bash
git add -A && git commit -m "test(workers): verify chunked transcription integration"
```

---

### Task 5: Push and deploy

**Files:**
- No file changes

- [ ] **Step 1: Run full test suite**

```bash
cd apps/workers && pnpm test -- --reporter verbose
```

Expected: All tests PASS

- [ ] **Step 2: Typecheck entire repo**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Push to both remotes**

```bash
git push origin main && git push annote main
```

- [ ] **Step 4: Verify CI passes**

```bash
gh run list --limit 3
```

Wait for CI + Deploy Worker to complete successfully.

- [ ] **Step 5: Retrigger transcription for all prod captures**

Use the admin reprocess endpoint or ECS Exec to reprocess all captures with the new pipeline. This ensures all existing captures benefit from the chunking path (even though current captures are short, it validates the code path in production).
