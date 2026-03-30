export interface Capture {
  id: string;
  name: string;
  phoneA: string;
  phoneB: string;
  language: string;
  status: "created" | "calling" | "active" | "ended" | "completed";
  roomName?: string;
  egressId?: string;
  recordingUrl?: string;      // mixed (both callers)
  recordingUrlA?: string;     // caller A only
  recordingUrlB?: string;     // caller B only
  localRecordingPath?: string;
  durationSeconds?: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  _joinedCallers?: Set<string>; // runtime only — tracks which SIP callers are in the room
}
