export interface ScriptStep {
  id: number;
  prompt: string; // what to tell the tester to say
  expectedKeywords?: string[]; // keywords to auto-advance (optional)
}

export interface TestScenario {
  name: string;
  persona: string; // e.g. "Kannada-speaking user asking about home loan"
  agentPhone: string; // the voice agent's phone number
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
  testerCallSid?: string;
  agentCallSid?: string;
  conferenceSid?: string;
  transcript: TranscriptEntry[];
  currentScriptStep: number;
  recordingUrl?: string;
  recordingSid?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

// ── Capture mode (phone-to-phone recording for ASR datasets) ────────

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
  conferenceName: string;
  callSidA?: string;
  callSidB?: string;
  conferenceSid?: string;
  transcript: CaptureTranscriptEntry[];
  recordingUrl?: string;
  recordingSid?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

// WebSocket messages sent to frontend clients
export type ClientMessage =
  | { type: "transcript"; entry: TranscriptEntry | CaptureTranscriptEntry }
  | { type: "status"; status: Session["status"] | Capture["status"] }
  | { type: "script_advance"; step: number }
  | { type: "recording"; url: string }
  | { type: "call_event"; event: string; speaker: string; detail?: string };
