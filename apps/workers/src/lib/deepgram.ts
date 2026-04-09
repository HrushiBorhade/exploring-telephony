import { DeepgramClient } from "@deepgram/sdk";
import { logger } from "../logger";
import type { Segment, TranscriptionResult } from "./gemini";

const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY! } as any);

export async function transcribeWithDeepgram(
  audioBuffer: Buffer,
  mimeType: string = "audio/mp3",
): Promise<TranscriptionResult> {
  logger.info({ sizeKB: (audioBuffer.length / 1024).toFixed(1), mimeType }, "[DEEPGRAM] Starting transcription");

  const data: any = await deepgram.listen.v1.media.transcribeFile(audioBuffer, {
    model: "nova-3",
    smart_format: true,
    detect_language: true,
    utterances: true,
    punctuate: true,
  });

  const segments: Segment[] = [];

  // Use utterances for timestamped segments
  const utterances = data?.results?.utterances ?? [];
  for (const u of utterances) {
    segments.push({
      startSeconds: u.start,
      endSeconds: u.end,
      content: u.transcript,
      language: (u as any).languages?.[0] || (data?.results?.channels?.[0] as any)?.detected_language || "en",
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
        language: (channel as any)?.detected_language || "en",
        emotion: "neutral",
      });
    }
  }

  logger.info({ segmentCount: segments.length }, "[DEEPGRAM] Transcription complete");
  return { segments };
}
