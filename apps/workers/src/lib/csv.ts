import { stringify } from "csv-stringify/sync";
import type { Segment } from "./gemini";

export interface CsvRow {
  utterance_text: string;
  audio_clip_url: string;
  timestamp_start: string;
  timestamp_end: string;
  participant: string;
  participant_track_url: string;
  emotion: string;
  language: string;
  capture_id: string;
}

function formatMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface ParticipantData {
  segments: Segment[];
  clipUrls: string[];
  trackUrl: string;
}

function toRows(captureId: string, participant: ParticipantData, label: string): CsvRow[] {
  return participant.segments.map((seg, i) => ({
    utterance_text: seg.content,
    audio_clip_url: participant.clipUrls[i] || "",
    timestamp_start: formatMMSS(seg.startSeconds),
    timestamp_end: formatMMSS(seg.endSeconds),
    participant: label,
    participant_track_url: participant.trackUrl,
    emotion: seg.emotion,
    language: seg.language,
    capture_id: captureId,
  }));
}

export function generateDatasetCsv(
  captureId: string,
  participantA: ParticipantData,
  participantB: ParticipantData,
): string {
  // Interleave by start time for conversation flow (sorted chronologically)
  const rows: CsvRow[] = [
    ...toRows(captureId, participantA, "participant_a"),
    ...toRows(captureId, participantB, "participant_b"),
  ].sort((a, b) => {
    const tA = a.timestamp_start.split(":").reduce((acc, v, i) => acc + Number(v) * (i === 0 ? 60 : 1), 0);
    const tB = b.timestamp_start.split(":").reduce((acc, v, i) => acc + Number(v) * (i === 0 ? 60 : 1), 0);
    return tA - tB;
  });

  // Add turn index for conversation ordering
  const indexed = rows.map((row, i) => ({ turn_index: i + 1, ...row }));

  return stringify(indexed, {
    header: true,
    columns: [
      "turn_index",
      "participant",
      "utterance_text",
      "timestamp_start",
      "timestamp_end",
      "audio_clip_url",
      "participant_track_url",
      "emotion",
      "language",
      "capture_id",
    ],
  });
}
