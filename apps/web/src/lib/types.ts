export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CaptureStats {
  total: number;
  completed: number;
  totalDuration: number;
  verifiedCount: number;
  verifiedDuration: number;
  thisWeek: number;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  role: "user" | "admin";
  banned: boolean;
  banReason: string | null;
  banExpires: number | null;
  createdAt: string;
}

export interface AdminStats {
  totalUsers: number;
  totalCaptures: number;
  completedCaptures: number;
  pendingReview: number;
  verified: number;
  totalDuration: number;
  thisWeek: number;
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
  durationSeconds?: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface ModerationFlag {
  type: "pii" | "abuse" | "confidential";
  severity: "high" | "medium" | "low";
  description: string;
}

export interface Utterance {
  start: number;
  end: number;
  text: string;
  language: string;
  emotion: "happy" | "sad" | "angry" | "neutral";
  audioUrl: string;
  flags?: ModerationFlag[];
}

export interface UserProfile {
  id: string;
  name: string;
  age: number;
  gender: string;
  city: string;
  state: string;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserLanguage {
  id: number;
  userId: string;
  languageCode: string;
  languageName: string;
  isPrimary: boolean;
  dialects: string[] | null;
  createdAt: string;
}

export interface ProfileResponse {
  profile: UserProfile | null;
  languages: UserLanguage[];
  onboardingCompleted: boolean;
}

export interface ThemeSample {
  id: number;
  category: "alphanumeric" | "healthcare" | "short_utterances";
  language: "hindi" | "telugu";
  data: Record<string, string>;
  status: "available" | "assigned" | "completed";
  publicToken: string | null;
}

export interface ThemeAvailability {
  language: string;
  available: number;
  total: number;
}

export interface FormValidationResult {
  field: string;
  submitted: string;
  correct: boolean;
}
