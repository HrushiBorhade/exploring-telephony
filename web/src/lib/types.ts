export interface Capture {
  id: string;
  name: string;
  phoneA: string;
  phoneB: string;
  language: string;
  status: "created" | "calling" | "active" | "ended" | "completed";
  roomName?: string;
  recordingUrl?: string;
  recordingUrlA?: string;
  recordingUrlB?: string;
  localRecordingPath?: string;
  durationSeconds?: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}
