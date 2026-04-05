# Frontend UI Implementation Plan

> Update the capture detail page for the new audio pipeline: processing status, utterance clips with inline players, CSV download, and layout fixes.

---

## What Changed in the Backend

| Before | After |
|--------|-------|
| Status: `created → calling → active → ended → completed` | Status: `created → calling → active → ended → processing → completed` |
| Transcript: flat text with confidence scores | Transcript: segments with `start`, `end`, `text`, `language`, `emotion`, `audioUrl` |
| Audio: MP4 files in flat S3 paths | Audio: MP3 files in structured `captures/{id}/...` paths |
| No CSV export | `datasetCsvUrl` field on completed captures |
| No emotion/language data | Each utterance has `emotion` + `language` from Gemini |

---

## Changes Needed

### 1. Add `processing` Status to Detail Page

**Current:** `ended` with `startedAt` shows "Processing recordings..." with bar visualizer.
**New:** Explicit `processing` status from backend when BullMQ job is running.

```
Status flow in UI:
  created → calling → active → ended → processing → completed
                                  ↑         ↑
                           call ended    BullMQ job running
                                         (transcribe + slice)
```

**File:** `apps/web/src/app/capture/[id]/page.tsx`

Add between `ended` and `completed` states:
```tsx
{capture.status === "processing" && (
  <div className="space-y-4">
    <BarVisualizer barCount={18} state="thinking" demo centerAlign minHeight={10} maxHeight={70} />
    <p className="text-sm text-muted-foreground text-center">
      Transcribing & processing audio clips...
    </p>
  </div>
)}
```

### 2. Update Types

**File:** `apps/web/src/lib/types.ts`

```typescript
interface Capture {
  // ... existing fields
  status: "created" | "calling" | "active" | "ended" | "processing" | "completed";
  datasetCsvUrl?: string | null;
}

interface Utterance {
  start: number;
  end: number;
  text: string;
  language: string;
  emotion: "happy" | "sad" | "angry" | "neutral";
  audioUrl: string;
}
```

### 3. Update Polling Logic

**File:** `apps/web/src/lib/api.ts`

Add `processing` to the fast-poll statuses:
```typescript
if (data.status === "calling" || data.status === "active" || data.status === "processing") return 2_000;
```

### 4. Redesign Transcript Section (Main UI Change)

**Current layout (overflow issues):**
```
┌─────────────────────────────────────┐
│ WaveformPlayer: Mixed               │  ← max-w-lg, cramped
│ WaveformPlayer: Phone A             │
│ WaveformPlayer: Phone B             │
│                                     │
│ ┌─ Phone A Transcript ────────────┐ │
│ │ 0:12.3 → 0:45.8  text  95%     │ │  ← scrollable list
│ │ [mini audio player]             │ │  ← tiny, hard to use
│ └─────────────────────────────────┘ │
│ ┌─ Phone B Transcript ────────────┐ │
│ │ ...                             │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Proposed layout (wider, cleaner):**
```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back   Capture Name          phoneA ↔ phoneB    [Download CSV]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Mixed Recording                                                │
│  [━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ▶ 2:34 / 5:12]   │
│                                                                 │
│  ┌─ Participant A ──────────────────┐ ┌─ Participant B ────────┐│
│  │ [━━━━━━━━━━━━━━━━ ▶ 0:00/2:34]  │ │ [━━━━━━━━━ ▶ 0:00/2:│ │
│  └──────────────────────────────────┘ └────────────────────────┘│
│                                                                 │
│  Utterances                                              CSV ↓  │
│  ┌──────────────────────────────────────────────────────────── ┐│
│  │ 🔵 A  00:05 → 00:08  "Hello how are you"        neutral en ││
│  │       [━━━━━━━━ ▶ 0:00 / 0:03]                             ││
│  │                                                             ││
│  │ 🟠 B  00:03 → 00:07  "I'm good thanks"          happy   en ││
│  │       [━━━━━━━━ ▶ 0:00 / 0:04]                             ││
│  │                                                             ││
│  │ 🔵 A  00:12 → 00:15  "I'm calling about..."     neutral en ││
│  │       [━━━━━━━━ ▶ 0:00 / 0:03]                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Details                                                        │
│  Duration: 5:12  │  Language: en  │  Created: Apr 5, 2026       │
└─────────────────────────────────────────────────────────────────┘
```

### 5. Key Layout Changes

**a. Widen the content area**
- Change `max-w-lg` → `max-w-3xl` for the completed state
- More room for transcripts + inline audio players

**b. Unified utterance list (not split by participant)**
- Merge A + B utterances into a single chronological list
- Color-coded participant tags (blue dot = A, orange dot = B)
- Each utterance shows: participant tag, timestamp, text, emotion badge, language

**c. Inline WaveformPlayer for each utterance clip**
- Reuse the existing `WaveformPlayer` component
- Smaller variant: no label, compact height
- Uses the utterance's `audioUrl` from the Gemini pipeline

**d. CSV download button**
- Top-right of utterances section
- Downloads `captures/{id}/dataset.csv` directly from S3

**e. Emotion badges**
- Tiny inline badges: `😊 happy`, `😐 neutral`, `😢 sad`, `😠 angry`
- Or just text badges with color: green/gray/blue/red

**f. Remove overflow issues**
- Remove `max-h-[32rem]` constraint on transcript container
- Let the page scroll naturally
- No inner scroll boxes

### 6. Status Badge Update

**File:** `apps/web/src/app/capture/page.tsx` (dashboard) + `[id]/page.tsx`

Add `processing` status styling:
```tsx
processing: "bg-purple-950 text-purple-400 border-purple-900"
```

With a pulsing dot like `calling` and `active`.

### 7. Dashboard Table Update

Add `processing` to the status badge map. No other dashboard changes needed.

---

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/src/lib/types.ts` | Add `processing` status, `datasetCsvUrl`, `Utterance` interface |
| `apps/web/src/lib/api.ts` | Add `processing` to fast-poll statuses |
| `apps/web/src/app/capture/page.tsx` | Add `processing` status badge |
| `apps/web/src/app/capture/[id]/page.tsx` | Add processing state UI, redesign completed state layout, utterance list, CSV button |

## Files NOT Modified
- `waveform-player.tsx` — reuse as-is for clips
- `audio-player.tsx` — no changes needed
- `bar-visualizer.tsx` — no changes
- `globals.css` — design tokens stay
- `components/ui/*` — all shadcn components used as-is

---

## Design Principles (Following Existing System)

1. **No extra Card wrappers** — the current design uses minimal containers. Transcript items are just rows with borders, not cards-in-cards.
2. **Dark theme native** — all colors use the existing oklch tokens. Status colors follow the established pattern.
3. **Compact audio players** — clip players should be inline, not full-width waveform players. Just a play button + slim progress bar + time.
4. **Information density** — utterances show timestamp, text, participant, emotion, language all in one row. No unnecessary whitespace or padding.
5. **Scroll naturally** — the page scrolls, not an inner container. Remove `max-h-[32rem] overflow-y-auto`.

---

## Implementation Order

| Step | What | Effort |
|------|------|--------|
| 1 | Update `types.ts` + `api.ts` | 5 min |
| 2 | Add `processing` status to dashboard + detail page | 10 min |
| 3 | Redesign completed state layout (wider, 2-col participant tracks) | 20 min |
| 4 | Build unified utterance list with inline clip players | 30 min |
| 5 | Add CSV download button | 5 min |
| 6 | Remove overflow constraints, test layout | 10 min |
| **Total** | | **~1.5 hours** |
