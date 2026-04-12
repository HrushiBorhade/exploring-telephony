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

/**
 * Transcribe audio with Deepgram nova-3.
 *
 * Uses language="hi" (Hindi) as default — this handles English code-mixing
 * natively and produces Devanagari script for Hindi words. Works correctly
 * on pure English audio too. For a platform focused on Indian telephony,
 * this is the most reliable setting.
 */
export async function transcribeWithDeepgram(
  audioBuffer: Buffer,
  mimeType: string = "audio/mp3",
): Promise<TranscriptionResult> {
  logger.info({ sizeKB: (audioBuffer.length / 1024).toFixed(1), mimeType }, "[DEEPGRAM] Starting transcription");

  const data: any = await getDeepgram().listen.v1.media.transcribeFile(audioBuffer, {
    model: "nova-3",
    smart_format: true,
    utterances: true,
    punctuate: true,
    language: "hi",
    utt_split: 1.0,
  });

  const segments: Segment[] = [];

  const utterances = data?.results?.utterances ?? [];
  for (const u of utterances) {
    segments.push({
      startSeconds: u.start,
      endSeconds: u.end,
      content: u.transcript,
      language: "hi",
      emotion: "neutral",
    });
  }

  // Fallback: if no utterances, use channel-level transcript
  if (segments.length === 0) {
    const channel = data?.results?.channels?.[0];
    const alt = channel?.alternatives?.[0];
    if (alt?.transcript) {
      const lastWord = alt.words?.at(-1);
      segments.push({
        startSeconds: 0,
        endSeconds: lastWord?.end ?? 0,
        content: alt.transcript,
        language: "hi",
        emotion: "neutral",
      });
    }
  }

  logger.info({ segmentCount: segments.length }, "[DEEPGRAM] Transcription complete");
  return { segments };
}
