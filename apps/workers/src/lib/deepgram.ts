import { DeepgramClient } from "@deepgram/sdk";
import { logger } from "../logger";
import type { Segment, TranscriptionResult } from "./gemini";

let _deepgram: DeepgramClient | undefined;
function getDeepgram(): DeepgramClient {
  if (!_deepgram) {
    const { env } = require("../env");
    _deepgram = new DeepgramClient({ apiKey: env.DEEPGRAM_API_KEY! } as any);
  }
  return _deepgram;
}

// ── Word-level types ────────────────────────────────────────────────

interface DGWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
}

// ── Configuration ───────────────────────────────────────────────────

const MAX_WORD_DURATION = 2.0;     // No single word is longer than 2 seconds
const MIN_WORD_CONFIDENCE = 0.3;   // Below this = ghost detection, drop it
const SILENCE_THRESHOLD = 0.7;     // Gap between words that splits utterances
const MAX_UTTERANCE_DURATION = 15; // Force-split utterances longer than this
const PADDING = 0.05;              // 50ms padding before/after each utterance

// ── Core: clean words → group into utterances ───────────────────────

/**
 * Clean broken word timestamps from Deepgram.
 * Fixes: overlapping words, abnormally long words, low-confidence ghost detections.
 */
function cleanWords(raw: DGWord[]): DGWord[] {
  // Drop ghost detections
  const filtered = raw.filter((w) => w.confidence >= MIN_WORD_CONFIDENCE);

  // Sort by start time (should already be sorted, but defensive)
  filtered.sort((a, b) => a.start - b.start);

  // Fix durations and overlaps
  for (let i = 0; i < filtered.length; i++) {
    const w = filtered[i];

    // Cap word duration
    if (w.end - w.start > MAX_WORD_DURATION) {
      w.end = w.start + MAX_WORD_DURATION;
    }

    // Fix overlap: if this word starts before previous word ends, snap forward
    if (i > 0 && w.start < filtered[i - 1].end) {
      w.start = filtered[i - 1].end;
      // If fixing the start pushed it past the end, drop the word
      if (w.start >= w.end) {
        filtered.splice(i, 1);
        i--;
      }
    }
  }

  return filtered;
}

/**
 * Group consecutive words into utterances based on silence gaps.
 * Each utterance starts at the first word and ends at the last word.
 * This is how production ASR pipelines (Kaldi, Lhotse) segment audio.
 */
function groupWordsIntoUtterances(words: DGWord[]): Segment[] {
  if (words.length === 0) return [];

  const segments: Segment[] = [];
  let group: DGWord[] = [words[0]];

  const flush = () => {
    if (group.length === 0) return;
    const text = group.map((w) => w.punctuated_word || w.word).join(" ");
    const confidence = group.reduce((s, w) => s + w.confidence, 0) / group.length;
    segments.push({
      startSeconds: Math.max(0, group[0].start - PADDING),
      endSeconds: group[group.length - 1].end + PADDING,
      content: text,
      language: "hi",
      emotion: "neutral",
    });
    group = [];
  };

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    const duration = words[i].end - group[0].start;

    if (gap >= SILENCE_THRESHOLD || duration >= MAX_UTTERANCE_DURATION) {
      flush();
      group = [words[i]];
    } else {
      group.push(words[i]);
    }
  }

  flush();
  return segments;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Transcribe audio with Deepgram nova-3.
 *
 * Uses word-level timestamps (frame-accurate from acoustic model),
 * then groups words into utterances by silence gaps. This avoids
 * Deepgram's built-in utterance grouping which can produce 16-second
 * windows for a single short word.
 */
export async function transcribeWithDeepgram(
  audioBuffer: Buffer,
  mimeType: string = "audio/mp3",
): Promise<TranscriptionResult> {
  logger.info({ sizeKB: (audioBuffer.length / 1024).toFixed(1), mimeType }, "[DEEPGRAM] Starting transcription");

  const data: any = await getDeepgram().listen.v1.media.transcribeFile(audioBuffer, {
    model: "nova-3",
    smart_format: true,
    punctuate: true,
    language: "hi",
  });

  // Get word-level timestamps (always returned, frame-accurate)
  const rawWords: DGWord[] = data?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  logger.info({ rawWordCount: rawWords.length }, "[DEEPGRAM] Words received");

  // Clean broken timestamps, then group into utterances
  const words = cleanWords(rawWords);
  const segments = groupWordsIntoUtterances(words);

  logger.info({
    cleanedWordCount: words.length,
    droppedWords: rawWords.length - words.length,
    segmentCount: segments.length,
  }, "[DEEPGRAM] Transcription complete");

  return { segments };
}
