import { GoogleGenAI, Type } from "@google/genai";
import { logger } from "../logger";
import { transcribeWithDeepgram } from "./deepgram";

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

/**
 * Transcribe audio with Gemini, falling back to Deepgram on 503/429 errors.
 */
export async function transcribeWithGemini(
  audioBuffer: Buffer,
  mimeType: string = "audio/mp3",
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
