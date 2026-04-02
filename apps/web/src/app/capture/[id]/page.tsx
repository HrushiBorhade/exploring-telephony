"use client";

import { useParams, useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { BarVisualizer } from "@/components/ui/bar-visualizer";
import { WaveformPlayer } from "@/components/waveform-player";
import { useState } from "react";
import { useCapture, useStartCapture, useEndCapture } from "@/lib/api";

const R2_PUBLIC = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "https://pub-c4f497a2d9354081a36aee5f920fa419.r2.dev";

function toPublicUrl(r2Url?: string | null) {
  if (!r2Url) return null;
  const filename = r2Url.split("/").pop();
  return filename ? `${R2_PUBLIC}/recordings/${filename}` : null;
}

function fmt(s?: number | null) {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const statusConfig: Record<string, { label: string; badgeClass: string; dot: string; pulse?: boolean }> = {
  created:   { label: "Ready",          badgeClass: "bg-zinc-800 text-zinc-300 border-zinc-700",          dot: "bg-zinc-400" },
  calling:   { label: "Calling...",     badgeClass: "bg-yellow-950 text-yellow-300 border-yellow-900",    dot: "bg-yellow-400", pulse: true },
  active:    { label: "In Call",        badgeClass: "bg-emerald-950 text-emerald-300 border-emerald-900", dot: "bg-emerald-400", pulse: true },
  ended:     { label: "Processing...",  badgeClass: "bg-blue-950 text-blue-300 border-blue-900",          dot: "bg-blue-400", pulse: true },
  completed: { label: "Recording Ready", badgeClass: "bg-emerald-950 text-emerald-300 border-emerald-900", dot: "bg-emerald-400" },
};

function DetailSkeleton() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-14" />
          <Separator orientation="vertical" className="h-6" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <Skeleton className="h-6 w-28 rounded-full" />
      </header>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-lg space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CaptureDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: capture, isLoading, error } = useCapture(id);
  const startMutation = useStartCapture(id);
  const endMutation = useEndCapture(id);
  // Track actual audio file duration — overrides DB durationSeconds (which can include ringing time)
  const [audioDuration, setAudioDuration] = useState<number | null>(null);

  if (isLoading && !capture) return <DetailSkeleton />;

  if (error && !capture) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <p className="font-medium">Failed to load capture</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => router.push("/capture")}>Back</Button>
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!capture) return <DetailSkeleton />;

  // "ended" with no startedAt means the call never connected (dialing failed)
  const callFailed = capture.status === "ended" && !capture.startedAt;
  const cfg = callFailed
    ? { label: "Call Failed", badgeClass: "bg-red-950 text-red-300 border-red-900", dot: "bg-red-400" }
    : (statusConfig[capture.status] ?? statusConfig.created);
  const mixedUrl   = toPublicUrl(capture.recordingUrl);
  const callerAUrl = toPublicUrl(capture.recordingUrlA);
  const callerBUrl = toPublicUrl(capture.recordingUrlB);

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ─────────────────────────────────── */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push("/capture")}>
            Back
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <div>
            <h1 className="text-sm font-semibold">{capture.name || "Untitled"}</h1>
            <p className="text-xs text-muted-foreground font-mono">
              {capture.phoneA} ↔ {capture.phoneB}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="outline" className={cfg.badgeClass}>
            <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}${cfg.pulse ? " animate-pulse" : ""}`} />
            {cfg.label}
          </Badge>

          {capture.status === "created" && (
            <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
              {startMutation.isPending
                ? <><LoaderCircle className="size-4 animate-spin" /> Starting...</>
                : "Start Call"}
            </Button>
          )}
          {(capture.status === "calling" || capture.status === "active") && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => endMutation.mutate()}
              disabled={endMutation.isPending || startMutation.isPending}
            >
              {endMutation.isPending
                ? <><LoaderCircle className="size-4 animate-spin" /> Ending...</>
                : "End Call"}
            </Button>
          )}
        </div>
      </header>

      {/* ── Body ───────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-lg space-y-4">

          {/* ── Main panel ── */}
          <div className="rounded-xl border border-border overflow-hidden">

            {/* created */}
            {capture.status === "created" && (
              <div className="p-8 text-center text-muted-foreground text-sm">
                Click &quot;Start Call&quot; to bridge both phones and begin recording.
              </div>
            )}

            {/* calling */}
            {capture.status === "calling" && (
              <div className="p-6 space-y-3">
                <p className="text-center text-xs font-medium text-yellow-400 uppercase tracking-widest">
                  Dialling
                </p>
                <BarVisualizer
                  state="connecting"
                  demo
                  barCount={18}
                  minHeight={15}
                  maxHeight={90}
                  centerAlign
                  className="bg-transparent border-0 h-24 rounded-none"
                />
                <p className="text-center text-xs text-muted-foreground">
                  Calling {capture.phoneA} and {capture.phoneB}…
                </p>
              </div>
            )}

            {/* active */}
            {capture.status === "active" && (
              <div className="p-6 space-y-3">
                <p className="text-center text-xs font-medium text-emerald-400 uppercase tracking-widest">
                  Recording
                </p>
                <BarVisualizer
                  state="speaking"
                  demo
                  barCount={18}
                  minHeight={10}
                  maxHeight={95}
                  centerAlign
                  className="bg-transparent border-0 h-24 rounded-none"
                />
                <p className="text-center text-xs text-muted-foreground">
                  Both parties connected · recording in progress
                </p>
              </div>
            )}

            {/* ended — call failed (never reached active) */}
            {capture.status === "ended" && !capture.startedAt && (
              <div className="p-8 text-center space-y-3">
                <p className="text-xs font-medium text-red-400 uppercase tracking-widest">
                  Call Failed
                </p>
                <p className="text-sm text-muted-foreground">
                  One or both phones didn&apos;t answer. Check the numbers and try again.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.push("/capture")}
                >
                  Back to Dashboard
                </Button>
              </div>
            )}

            {/* ended — recording uploading (call was successful) */}
            {capture.status === "ended" && capture.startedAt && (
              <div className="p-6 space-y-3">
                <p className="text-center text-xs font-medium text-blue-400 uppercase tracking-widest">
                  Processing
                </p>
                <BarVisualizer
                  state="thinking"
                  demo
                  barCount={18}
                  minHeight={10}
                  maxHeight={70}
                  centerAlign
                  className="bg-transparent border-0 h-24 rounded-none"
                />
                <p className="text-center text-xs text-muted-foreground">
                  Uploading recordings to storage — usually 10–30 s
                </p>
              </div>
            )}

            {/* completed */}
            {capture.status === "completed" && (
              <div className="p-6 space-y-5">
                <p className="text-xs font-medium text-emerald-400 uppercase tracking-widest text-center">
                  Recordings ready
                </p>

                {mixedUrl && (
                  <WaveformPlayer
                    url={mixedUrl}
                    label="Mixed — both callers"
                    accentColor="#a1a1aa"
                    onDurationLoaded={setAudioDuration}
                  />
                )}
                {callerAUrl && (
                  <WaveformPlayer
                    url={callerAUrl}
                    label={`Phone A — ${capture.phoneA}`}
                    accentColor="#60a5fa"
                  />
                )}
                {callerBUrl && (
                  <WaveformPlayer
                    url={callerBUrl}
                    label={`Phone B — ${capture.phoneB}`}
                    accentColor="#fb923c"
                  />
                )}
              </div>
            )}
          </div>

          {/* ── Metadata ── */}
          <div className="rounded-xl border border-border p-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[
              { label: "Phone A",  value: capture.phoneA,  mono: true },
              { label: "Phone B",  value: capture.phoneB,  mono: true },
              { label: "Language", value: capture.language || "—" },
              {
                label: "Duration",
                // Prefer actual audio file duration (accurate); fall back to DB value
                value: audioDuration != null ? fmt(Math.round(audioDuration)) : fmt(capture.durationSeconds),
                mono: true,
              },
              { label: "Created",  value: new Date(capture.createdAt).toLocaleString() },
              { label: "Status",   value: capture.status },
            ].map(({ label, value, mono }) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                <p className={mono ? "font-mono text-sm" : "text-sm"}>{value}</p>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
