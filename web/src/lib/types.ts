export interface ScriptStep {
  id: number;
  prompt: string;
  expectedKeywords?: string[];
}

export interface TestScenario {
  name: string;
  persona: string;
  agentPhone: string;
  script: ScriptStep[];
}

export interface TranscriptEntry {
  speaker: "tester" | "agent";
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface Session {
  id: string;
  scenario: TestScenario;
  testerPhone: string;
  status: "created" | "calling" | "active" | "ended";
  conferenceName: string;
  transcript: TranscriptEntry[];
  currentScriptStep: number;
  recordingUrl?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface SessionSummary {
  id: string;
  scenario: { name: string; persona: string };
  testerPhone: string;
  status: Session["status"];
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  recordingUrl?: string;
  transcriptCount: number;
}

// ── Capture mode types ──────────────────────────────────────────────

export interface CaptureTranscriptEntry {
  speaker: "caller_a" | "caller_b";
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface Capture {
  id: string;
  name: string;
  phoneA: string;
  phoneB: string;
  language: string;
  status: "created" | "calling" | "active" | "ended";
  transcript: CaptureTranscriptEntry[];
  recordingUrl?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface CaptureSummary {
  id: string;
  name: string;
  phoneA: string;
  phoneB: string;
  language: string;
  status: Capture["status"];
  createdAt: string;
  endedAt?: string;
  recordingUrl?: string;
  transcriptCount: number;
}

export type WsMessage =
  | { type: "transcript"; entry: TranscriptEntry | CaptureTranscriptEntry }
  | { type: "status"; status: string }
  | { type: "script_advance"; step: number }
  | { type: "recording"; url: string }
  | { type: "call_event"; event: string; speaker: string; detail?: string };
