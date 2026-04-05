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
  const rows: CsvRow[] = [
    ...toRows(captureId, participantA, "participant_a"),
    ...toRows(captureId, participantB, "participant_b"),
  ];

  return stringify(rows, {
    header: true,
    columns: [
      "utterance_text",
      "audio_clip_url",
      "timestamp_start",
      "timestamp_end",
      "participant",
      "participant_track_url",
      "emotion",
      "language",
      "capture_id",
    ],
  });
}
