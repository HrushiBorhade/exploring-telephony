export interface Capture {
  id: string;
  userId?: string;
  name: string;
  phoneA: string;
  phoneB: string;
  language: string;
  status: "created" | "calling" | "active" | "ended" | "processing" | "completed";
  roomName?: string;
  egressId?: string;
  recordingUrl?: string;
  recordingUrlA?: string;
  recordingUrlB?: string;
  localRecordingPath?: string;
  transcriptA?: string | null;
  transcriptB?: string | null;
  datasetCsvUrl?: string | null;
  durationSeconds?: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface Utterance {
  start: number;
  end: number;
  text: string;
  language: string;
  emotion: "happy" | "sad" | "angry" | "neutral";
  audioUrl: string;
}
