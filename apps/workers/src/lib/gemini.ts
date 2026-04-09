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
): Promise<TranscriptionResult> {
  try {
    return await _transcribeGemini(audioBuffer, mimeType);
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
          text: `Transcribe this audio recording precisely.

This audio may contain MULTIPLE LANGUAGES including English, Hindi, Kannada, Telugu, Tamil, Marathi, or code-switching between languages mid-sentence. Transcribe each segment in the ORIGINAL language spoken — do not translate.

Requirements:
1. Return EVERY utterance/segment with accurate start and end times in SECONDS (decimal, e.g. 5.2).
2. Detect the language of each segment (use ISO 639-1 codes: "en", "hi", "kn", "te", "ta", "mr", etc.).
3. For code-switched segments (mixing languages), use the dominant language code and transcribe exactly as spoken.
4. Detect the primary emotion: happy, sad, angry, or neutral.
5. Be thorough — do not skip any speech, even short utterances like "yes", "hmm", "haan", "okay", "accha".
6. Use the exact words spoken in the original language, no paraphrasing, no translation.
7. If there is silence or no speech, return an empty segments array.`,
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
