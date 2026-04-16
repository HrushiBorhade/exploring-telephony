export interface ModerationFlag {
  type: "pii" | "abuse" | "confidential";
  severity: "high" | "medium" | "low";
  description: string;
}

export interface Capture {
  id: string;
  userId?: string;
  name: string;
  phoneA: string;
  phoneB: string;
  language: string;
  status: "created" | "calling" | "active" | "ended" | "processing" | "completed" | "failed";
  verified?: boolean | null;
  themeSampleId?: number | null;
  roomName?: string;
  egressId?: string;
  recordingUrl?: string;
  recordingUrlA?: string;
  recordingUrlB?: string;
  transcriptA?: string | null;
  transcriptB?: string | null;
  datasetCsvUrl?: string | null;
  submittedFormValues?: string | null;
  durationSeconds?: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  _joinedCallers?: Set<string>;
  _egressStarting?: boolean;
  _egressIds?: string[];
}

export interface ThemeSample {
  id: number;
  category: "alphanumeric" | "healthcare" | "short_utterances" | "customer_support";
  language: "hindi" | "telugu";
  data: string;
  status: "available" | "assigned" | "completed";
  assignedCaptureId: string | null;
  assignedAt: string | null;
  publicToken: string | null;
  createdAt: string;
}
