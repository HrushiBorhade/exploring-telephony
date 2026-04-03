import * as dbq from "@repo/db";
import { logger } from "../logger";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-3&utterances=true&smart_format=true&language=multi";

export interface Utterance {
  start: number;
  end: number;
  text: string;
  confidence: number;
}

/**
 * Transcribe a per-speaker recording via Deepgram Nova 3.
 * Stores utterance-level results (text + timestamps) in the DB.
 */
export async function transcribeRecording(
  captureId: string,
  audioUrl: string,
  caller: "a" | "b",
): Promise<void> {
  if (!DEEPGRAM_API_KEY) {
    logger.warn("[TRANSCRIBE] DEEPGRAM_API_KEY not set, skipping");
    return;
  }

  logger.info({ captureId, caller, audioUrl }, "[TRANSCRIBE] Starting");

  const res = await fetch(DEEPGRAM_URL, {
    method: "POST",
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: audioUrl }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Deepgram API error ${res.status}: ${body}`);
  }

  const data: any = await res.json();
  const rawUtterances = data?.results?.utterances ?? [];

  const utterances: Utterance[] = rawUtterances.map((u: any) => ({
    start: u.start,
    end: u.end,
    text: u.transcript,
    confidence: u.confidence,
  }));

  const field = caller === "a" ? "transcriptA" : "transcriptB";
  await dbq.updateCapture(captureId, { [field]: JSON.stringify(utterances) });

  logger.info({ captureId, caller, count: utterances.length }, "[TRANSCRIBE] Done");
}
