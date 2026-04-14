import type { Capture } from "@/lib/types";

export const statusConfig: Record<
  string,
  { label: string; className: string; dot: string; pulse?: boolean }
> = {
  created:         { label: "Ready",          className: "bg-muted text-muted-foreground",       dot: "bg-muted-foreground" },
  calling:         { label: "Dialing Phones...", className: "bg-amber-500/10 text-amber-500",     dot: "bg-amber-500", pulse: true },
  active:          { label: "Recording",      className: "bg-emerald-500/10 text-emerald-500",   dot: "bg-emerald-500", pulse: true },
  ended:           { label: "Saving Recordings...", className: "bg-blue-500/10 text-blue-500",   dot: "bg-blue-500", pulse: true },
  processing:      { label: "Transcribing...", className: "bg-violet-500/10 text-violet-500",    dot: "bg-violet-500", pulse: true },
  failed:          { label: "Failed",         className: "bg-destructive/10 text-destructive",   dot: "bg-destructive" },
  completed:       { label: "Completed",      className: "bg-emerald-500/10 text-emerald-500",   dot: "bg-emerald-500" },
  pending_review:  { label: "Pending Review", className: "bg-amber-500/10 text-amber-500",       dot: "bg-amber-500" },
  verified:        { label: "Verified",       className: "bg-emerald-500/10 text-emerald-500",   dot: "bg-emerald-500" },
};

export function getDisplayStatus(capture: { status: string; verified?: boolean | null }): string {
  if (capture.status !== "completed") return capture.status;
  if (capture.verified === true) return "verified";
  if (capture.verified === false) return "pending_review";
  return "completed";
}

export function formatDuration(seconds?: number | null): string | null {
  if (seconds == null || seconds === 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function navigateToCapture(c: Capture, push: (url: string) => void) {
  const base = `/dashboard/tasks/${c.id}`;
  push(c.themeSampleId ? `${base}/themed` : base);
}
