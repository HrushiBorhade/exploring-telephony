import { GoogleGenAI, Type } from "@google/genai";
import { writeFile, readFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { logger } from "../logger";
import { transcribeWithDeepgram } from "./deepgram";
import { splitIntoChunks } from "./ffmpeg";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface Segment {
  startSeconds: number;
  endSeconds: number;
  content: string;
  language: string;
  emotion: "happy" | "sad" | "angry" | "neutral";
}

export interface TranscriptionResult {
  segments: Segment[];
}

export interface ChunkTranscriptionResult {
  offsetSeconds: number;
  durationSeconds: number;
  segments: Segment[];
}

/**
 * Merge transcription results from overlapping audio chunks.
 *
 * Each chunk's segments have timestamps relative to the chunk start.
 * This function offsets timestamps to absolute positions, deduplicates
 * the overlap region (chunk N owns everything up to its end, chunk N+1
 * only contributes segments starting after that boundary), and sorts
 * all segments chronologically.
 */
export function mergeChunkSegments(chunkResults: ChunkTranscriptionResult[]): Segment[] {
  if (chunkResults.length === 0) return [];

  if (chunkResults.length === 1) {
    const chunk = chunkResults[0];
    return chunk.segments
      .map((s) => ({
        ...s,
        startSeconds: s.startSeconds + chunk.offsetSeconds,
        endSeconds: s.endSeconds + chunk.offsetSeconds,
      }))
      .sort((a, b) => a.startSeconds - b.startSeconds);
  }

  const allSegments: Segment[] = [];

  for (let i = 0; i < chunkResults.length; i++) {
    const chunk = chunkResults[i];

    for (const seg of chunk.segments) {
      const absoluteStart = seg.startSeconds + chunk.offsetSeconds;
      const absoluteEnd = seg.endSeconds + chunk.offsetSeconds;

      if (i === 0) {
        // First chunk: keep everything
        allSegments.push({ ...seg, startSeconds: absoluteStart, endSeconds: absoluteEnd });
      } else {
        // Subsequent chunks: only keep segments that START at or after the
        // previous chunk's end (i.e., outside the overlap region)
        const prevChunk = chunkResults[i - 1];
        const overlapEnd = prevChunk.offsetSeconds + prevChunk.durationSeconds;

        if (absoluteStart >= overlapEnd) {
          allSegments.push({ ...seg, startSeconds: absoluteStart, endSeconds: absoluteEnd });
        }
      }
    }
  }

  return allSegments.sort((a, b) => a.startSeconds - b.startSeconds);
}

const CHUNK_DURATION = 600;   // 10 minutes
const OVERLAP_DURATION = 15;  // 15 seconds
const CHUNK_CONCURRENCY = 2;  // max parallel Gemini calls per track

/**
 * Transcribe audio with Gemini, automatically chunking tracks longer than 10 minutes.
 * Falls back to Deepgram per-chunk on 503/429 errors.
 */
export async function transcribeWithGemini(
  audioBuffer: Buffer,
  mimeType: string = "audio/mp3",
  audioDurationSeconds?: number,
): Promise<TranscriptionResult> {
  // Short audio: single call (fast path)
  if (!audioDurationSeconds || audioDurationSeconds <= CHUNK_DURATION) {
    return _transcribeSingle(audioBuffer, mimeType, audioDurationSeconds);
  }

  // Long audio: chunk → transcribe each → merge
  logger.info({ durationSeconds: audioDurationSeconds }, "[GEMINI] Audio exceeds 10min, chunking");

  const tmpDir = await mkdtemp(path.join(tmpdir(), "gemini-chunks-"));
  try {
    const inputPath = path.join(tmpDir, "input.mp3");
    await writeFile(inputPath, audioBuffer);

    const chunks = await splitIntoChunks(inputPath, tmpDir, {
      chunkDuration: CHUNK_DURATION,
      overlapDuration: OVERLAP_DURATION,
    });

    logger.info({ chunkCount: chunks.length }, "[GEMINI] Chunks created");

    // Transcribe chunks with limited concurrency
    // With BullMQ concurrency=3 and CHUNK_CONCURRENCY=2, worst case = 6 parallel Gemini calls
    const chunkResults: ChunkTranscriptionResult[] = [];

    for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
      const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (chunk, batchIdx) => {
          const chunkIdx = i + batchIdx;
          logger.info({ chunkIdx, offset: chunk.offsetSeconds, duration: chunk.durationSeconds }, "[GEMINI] Transcribing chunk");
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
 * Transcribe a single audio buffer (full short track or one chunk).
 * Falls back to Deepgram on Gemini 503/429.
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
      logger.warn("[GEMINI] Chunk unavailable, falling back to Deepgram");
      return transcribeWithDeepgram(audioBuffer, mimeType);
    }

    throw err;
  }
}

async function _transcribeGemini(
  audioBuffer: Buffer,
  mimeType: string,
  audioDurationSeconds?: number,
): Promise<TranscriptionResult> {
  logger.info({ sizeKB: (audioBuffer.length / 1024).toFixed(1), mimeType }, "[GEMINI] Starting transcription");

  const response = await genai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: {
      parts: [
        {
          inlineData: {
            data: audioBuffer.toString("base64"),
            mimeType,
          },
        },
        {
          text: `You are a professional multilingual transcription engine for telephony audio data.

TASK: Transcribe this audio clip faithfully — no paraphrasing, no normalization. Produce transcripts exactly as spoken.

SCRIPT RULES (CRITICAL — legal compliance):
- Hindi words → Devanagari script (e.g., "मैं ठीक हूँ", "क्या हाल है")
- Telugu words → Telugu script (e.g., "నేను బాగున్నాను")
- Tamil words → Tamil script (e.g., "நான் நல்லா இருக்கேன்")
- Bengali words → Bengali script (e.g., "আমি ভালো আছি")
- English words → Latin alphabet ALWAYS (e.g., "hello", "delivery", "okay", "BP", "HbA1c")
- Code-mixed sentences use BOTH scripts: "मैं delivery boy का wait कर रहा हूँ"
- NEVER romanize Indic languages (no "main theek hoon" — write "मैं ठीक हूँ")
- NEVER write English in Indic scripts (no "हेलो" for "hello")
- Medical terms, abbreviations, alphanumeric IDs stay in Latin: "BP", "OPD", "MH-7249A", "HbA1c"

TRANSCRIPTION RULES:
1. Return EVERY utterance with accurate start/end times in SECONDS (decimal, e.g. 5.2)
2. Detect language per segment: "en", "hi", "te", "ta", "bn", "kn", "mr"
3. For code-mixed segments, use the dominant language code
4. Detect emotion: happy, sad, angry, or neutral
5. Be thorough — include short utterances: "yes", "hmm", "हाँ", "okay", "अच्छा", "go", "stop"
6. Preserve filler words, false starts, and disfluencies exactly as spoken
7. Preserve abbreviations and special terminology verbatim (medical: BP, ECG, OPD, HbA1c, LDL)
8. For spelled-out content (names, emails, codes), transcribe each letter/digit separately
9. Empty segments array if silence/no speech
${audioDurationSeconds ? `10. IMPORTANT: This audio is exactly ${audioDurationSeconds.toFixed(1)} seconds long. Do NOT generate any timestamps beyond ${audioDurationSeconds.toFixed(1)} seconds.` : ""}`,
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          segments: {
            type: Type.ARRAY,
            description: "List of transcribed segments with timestamps in seconds",
            items: {
              type: Type.OBJECT,
              properties: {
                startSeconds: { type: Type.NUMBER, description: "Start time in seconds (decimal)" },
                endSeconds: { type: Type.NUMBER, description: "End time in seconds (decimal)" },
                content: { type: Type.STRING, description: "Exact transcribed text" },
                language: { type: Type.STRING, description: "ISO 639-1 language code" },
                emotion: {
                  type: Type.STRING,
                  enum: ["happy", "sad", "angry", "neutral"],
                },
              },
              required: ["startSeconds", "endSeconds", "content", "language", "emotion"],
            },
          },
        },
        required: ["segments"],
      },
    },
  });

  const result: TranscriptionResult = JSON.parse(response.text!);

  // Validate: endSeconds must be > startSeconds, no negative values
  result.segments = result.segments.filter((s) => {
    if (s.endSeconds <= s.startSeconds || s.startSeconds < 0) {
      logger.warn({ segment: s }, "[GEMINI] Invalid segment timestamps, skipping");
      return false;
    }
    return true;
  });

  logger.info({ segmentCount: result.segments.length }, "[GEMINI] Transcription complete");
  return result;
}
