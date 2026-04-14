import { GoogleGenAI, Type } from "@google/genai";
import { logger } from "../logger";

let _genai: GoogleGenAI | undefined;
function getGenAI(): GoogleGenAI {
  if (!_genai) {
    const { env } = require("../env");
    _genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return _genai;
}

export interface EnhancedUtterance {
  text: string;
  emotion: "happy" | "sad" | "angry" | "neutral";
  language: string;
  enhanced: boolean;
}

/**
 * Enhance a single utterance clip with Gemini Flash.
 * Sends the short audio clip (3-15s) to Gemini for:
 * - Better transcription text (Devanagari, code-mixing, medical terms)
 * - Emotion detection
 * - Language detection
 *
 * Returns enhanced result, or fallback with enhanced: false if Gemini fails.
 */
export async function enhanceUtterance(
  clipBuffer: Buffer,
  mimeType: string,
  fallbackText: string,
  fallbackLanguage: string,
): Promise<EnhancedUtterance> {
  try {
    const response = await Promise.race([
      getGenAI().models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: clipBuffer.toString("base64"), mimeType } },
            {
              text: `Transcribe this audio clip EXACTLY as spoken. Do NOT paraphrase, rephrase, translate, or change any words. Write what was said, nothing else.

CRITICAL:
- If the speaker says "Actually" in English, write "Actually" — do NOT replace with Hindi equivalent
- If the speaker says "ठीक है", write "ठीक है" — do NOT replace with English
- Every word must be EXACTLY what was spoken. No interpretation. No correction.

SCRIPT RULES:
- Hindi/Indic words → Devanagari script
- English words → Latin script ALWAYS (hello, actually, delivery, BP, HbA1c)
- Code-mixed → use BOTH scripts as spoken (Actually doctor ने बोला था)
- Medical terms stay Latin: BP, ECG, HbA1c, LDL, OPD

ALSO DETECT:
- emotion: happy, sad, angry, or neutral
- language: hi, en, te, ta, bn, kn, mr (dominant language of this utterance)`,
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING, description: "Exact transcription" },
              emotion: { type: Type.STRING, enum: ["happy", "sad", "angry", "neutral"] },
              language: { type: Type.STRING, description: "ISO 639-1 code" },
            },
            required: ["text", "emotion", "language"],
          },
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Gemini enhance timeout after 120s")), 120_000),
      ),
    ]);

    const result = JSON.parse(response.text!);

    // Validate: reject hallucinated or empty output
    if (!result.text || result.text.trim().length === 0) {
      return { text: fallbackText, emotion: "neutral", language: fallbackLanguage, enhanced: false };
    }

    // If Gemini's text is 3x+ longer than Deepgram's (by word count), it's likely hallucinated
    const dgWords = fallbackText.split(/\s+/).length;
    const gmWords = result.text.trim().split(/\s+/).length;
    if (dgWords > 0 && gmWords > dgWords * 3) {
      logger.debug({ dgWords, gmWords, dgText: fallbackText, gmText: result.text }, "[GEMINI-ENHANCE] Rejected hallucination");
      return { text: fallbackText, emotion: result.emotion || "neutral", language: result.language || fallbackLanguage, enhanced: false };
    }

    return {
      text: result.text.trim(),
      emotion: result.emotion || "neutral",
      language: result.language || fallbackLanguage,
      enhanced: true,
    };
  } catch (err: any) {
    logger.debug({ error: err.message }, "[GEMINI-ENHANCE] Failed, using Deepgram text");
    return { text: fallbackText, emotion: "neutral", language: fallbackLanguage, enhanced: false };
  }
}

/**
 * Enhance multiple utterances in batches.
 * Sends clips to Gemini in parallel (limited concurrency to avoid rate limits).
 */
export async function enhanceUtterances(
  clips: { buffer: Buffer; mimeType: string; fallbackText: string; fallbackLanguage: string }[],
  concurrency = 3,
): Promise<EnhancedUtterance[]> {
  const results: EnhancedUtterance[] = new Array(clips.length);

  for (let i = 0; i < clips.length; i += concurrency) {
    const batch = clips.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((clip) => enhanceUtterance(clip.buffer, clip.mimeType, clip.fallbackText, clip.fallbackLanguage)),
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }

  const enhanced = results.filter((r) => r.enhanced).length;
  logger.info({ total: clips.length, enhanced, failed: clips.length - enhanced }, "[GEMINI-ENHANCE] Batch complete");

  return results;
}
