"use client";

import { useParams, useRouter } from "next/navigation";
import { LoaderCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BarVisualizer } from "@/components/ui/bar-visualizer";
import { WaveformPlayer } from "@/components/waveform-player";
import { useState, useMemo, memo } from "react";
import { useCapture, useStartCapture, useEndCapture, proxyAudioUrl } from "@/lib/api";
import type { Utterance } from "@/lib/types";

function fmt(s?: number | null) {
  if (s == null) return "\u2014";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtTimestamp(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const participantColor = { a: "#60a5fa", b: "#fb923c" } as const;

const emotionClassName: Record<string, string> = {
  happy:   "text-emerald-400",
  sad:     "text-blue-400",
  angry:   "text-red-400",
  neutral: "text-zinc-500",
};

const statusConfig: Record<string, { label: string; badgeClass: string; dot: string; pulse?: boolean }> = {
  created:    { label: "Ready",            badgeClass: "bg-zinc-800 text-zinc-300 border-zinc-700",          dot: "bg-zinc-400" },
  calling:    { label: "Calling...",       badgeClass: "bg-yellow-950 text-yellow-300 border-yellow-900",    dot: "bg-yellow-400", pulse: true },
  active:     { label: "In Call",          badgeClass: "bg-emerald-950 text-emerald-300 border-emerald-900", dot: "bg-emerald-400", pulse: true },
  ended:      { label: "Processing...",    badgeClass: "bg-blue-950 text-blue-300 border-blue-900",          dot: "bg-blue-400", pulse: true },
  processing: { label: "Transcribing...",  badgeClass: "bg-purple-950 text-purple-300 border-purple-900",    dot: "bg-purple-400", pulse: true },
  completed:  { label: "Recording Ready",  badgeClass: "bg-emerald-950 text-emerald-300 border-emerald-900", dot: "bg-emerald-400" },
  failed:     { label: "Failed",           badgeClass: "bg-red-950 text-red-300 border-red-900",             dot: "bg-red-400" },
};

function DetailSkeleton() {
  return (
    <>
      <div className="flex items-center justify-between px-4 lg:px-6 py-4 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <div className="space-y-1.5 min-w-0">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <Skeleton className="h-6 w-28 rounded-full shrink-0" />
      </div>
      <div className="flex-1 flex items-center justify-center p-4 lg:p-6">
        <div className="w-full max-w-3xl space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </>
  );
}

function parseUtterances(raw: string | null | undefined, captureId: string): Utterance[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return arr.map((u: any) => ({
      start: u.start ?? u.startSeconds ?? 0,
      end: u.end ?? u.endSeconds ?? 0,
      text: u.text ?? u.content ?? "",
      language: u.language ?? "en",
      emotion: u.emotion ?? "neutral",
      audioUrl: u.audioUrl ? proxyAudioUrl(u.audioUrl, captureId) : "",
    }));
  } catch {
    return [];
  }
}

/** Single utterance row — memoized to prevent re-renders when sibling utterances change */
const UtteranceRow = memo(function UtteranceRow({
  u,
  color,
}: {
  u: Utterance;
  color: string;
}) {
  const emoCls = emotionClassName[u.emotion] ?? emotionClassName.neutral;
  return (
    <div className="group rounded-lg px-2 sm:px-3 py-2.5 hover:bg-muted/40 transition-colors">
      <div className="flex items-start gap-2 sm:gap-3">
        <span className="text-[11px] font-mono text-muted-foreground shrink-0 tabular-nums mt-0.5 w-[5rem] sm:w-[5.5rem]">
          {fmtTimestamp(u.start)} {"\u2192"} {fmtTimestamp(u.end)}
        </span>
        <span className="flex-1 text-sm leading-relaxed min-w-0 break-words">{u.text}</span>
        <div className="shrink-0 hidden sm:flex items-center gap-2 mt-0.5">
          <span className={`text-[10px] ${emoCls}`}>{u.emotion}</span>
          <span className="text-[10px] text-muted-foreground uppercase">{u.language}</span>
        </div>
      </div>
      {/* Mobile: emotion + language below text */}
      <div className="flex sm:hidden items-center gap-2 mt-1 ml-[5rem]">
        <span className={`text-[10px] ${emoCls}`}>{u.emotion}</span>
        <span className="text-[10px] text-muted-foreground uppercase">{u.language}</span>
      </div>
      {u.audioUrl && (
        <div className="mt-1.5">
          <WaveformPlayer url={u.audioUrl} label="" accentColor={color} />
        </div>
      )}
    </div>
  );
});

function UtteranceList({ utterances, color }: { utterances: Utterance[]; color: string }) {
  if (utterances.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No utterances detected</p>;
  }

  return (
    <div className="space-y-px pt-2">
      {utterances.map((u, i) => (
        <UtteranceRow key={`${i}-${u.start}-${u.end}`} u={u} color={color} />
      ))}
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
  const [audioDuration, setAudioDuration] = useState<number | null>(null);

  const utterancesA = useMemo(() => parseUtterances(capture?.transcriptA, id), [capture?.transcriptA, id]);
  const utterancesB = useMemo(() => parseUtterances(capture?.transcriptB, id), [capture?.transcriptB, id]);
  const hasUtterances = utterancesA.length > 0 || utterancesB.length > 0;

  const recordingUrl = useMemo(
    () => capture?.recordingUrl ? proxyAudioUrl(capture.recordingUrl, id) : null,
    [capture?.recordingUrl, id]
  );
  const recordingUrlA = useMemo(
    () => capture?.recordingUrlA ? proxyAudioUrl(capture.recordingUrlA, id) : null,
    [capture?.recordingUrlA, id]
  );
  const recordingUrlB = useMemo(
    () => capture?.recordingUrlB ? proxyAudioUrl(capture.recordingUrlB, id) : null,
    [capture?.recordingUrlB, id]
  );
  const datasetCsvProxyUrl = useMemo(
    () => capture?.datasetCsvUrl ? proxyAudioUrl(capture.datasetCsvUrl, id) : null,
    [capture?.datasetCsvUrl, id]
  );

  if (isLoading && !capture) return <DetailSkeleton />;

  if (error && !capture) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
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

  const callFailed = capture.status === "ended" && !capture.startedAt;
  const cfg = callFailed
    ? { label: "Call Failed", badgeClass: "bg-red-950 text-red-300 border-red-900", dot: "bg-red-400" }
    : (statusConfig[capture.status] ?? statusConfig.created);

  const isCompleted = capture.status === "completed";
  const isPreCall = capture.status === "created" || capture.status === "calling" || capture.status === "active";
  const isProcessing = capture.status === "processing" || (capture.status === "ended" && capture.startedAt);

  return (
    <>
      {/* ── Action bar ─────────────────────────────── */}
      <div className="flex items-center justify-between px-4 lg:px-6 py-4 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold truncate">{capture.name || "Untitled"}</h1>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {capture.phoneA} {"\u2194"} {capture.phoneB}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isCompleted && datasetCsvProxyUrl && (
            <a href={datasetCsvProxyUrl} download className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Download className="size-3.5" />
              CSV
            </a>
          )}

          <Badge variant="outline" className={`${cfg.badgeClass} whitespace-nowrap`}>
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
      </div>

      {/* ── Body ───────────────────────────────────── */}
      <div className={`flex-1 p-4 lg:p-6 ${isCompleted ? "max-w-4xl mx-auto w-full" : "flex items-center justify-center"}`}>
        <div className={`w-full ${isCompleted ? "" : "max-w-lg"} space-y-4 sm:space-y-5`}>

          {/* ── Pre-call / In-call states ── */}
          {isPreCall && (
            <div className="rounded-xl border border-border overflow-hidden">
              {capture.status === "created" && (
                <div className="p-6 sm:p-8 text-center text-muted-foreground text-sm">
                  Click &quot;Start Call&quot; to bridge both phones and begin recording.
                </div>
              )}

              {capture.status === "calling" && (
                <div className="p-4 sm:p-6 space-y-3">
                  <p className="text-center text-xs font-medium text-yellow-400 uppercase tracking-widest">Dialling</p>
                  <BarVisualizer state="connecting" demo barCount={18} minHeight={15} maxHeight={90} centerAlign className="bg-transparent border-0 h-24 rounded-none" />
                  <p className="text-center text-xs text-muted-foreground truncate">Calling {capture.phoneA} and {capture.phoneB}{"\u2026"}</p>
                </div>
              )}

              {capture.status === "active" && (
                <div className="p-4 sm:p-6 space-y-3">
                  <p className="text-center text-xs font-medium text-emerald-400 uppercase tracking-widest">Recording</p>
                  <BarVisualizer state="speaking" demo barCount={18} minHeight={10} maxHeight={95} centerAlign className="bg-transparent border-0 h-24 rounded-none" />
                  <p className="text-center text-xs text-muted-foreground">Both parties connected {"\u00B7"} recording in progress</p>
                </div>
              )}
            </div>
          )}

          {/* ── Call failed ── */}
          {callFailed && (
            <div className="rounded-xl border border-border p-6 sm:p-8 text-center space-y-3">
              <p className="text-xs font-medium text-red-400 uppercase tracking-widest">Call Failed</p>
              <p className="text-sm text-muted-foreground">One or both phones didn&apos;t answer. Check the numbers and try again.</p>
              <Button size="sm" variant="outline" onClick={() => router.push("/capture")}>Back to Dashboard</Button>
            </div>
          )}

          {/* ── Processing / Transcribing ── */}
          {isProcessing && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="p-4 sm:p-6 space-y-3">
                <p className="text-center text-xs font-medium text-purple-400 uppercase tracking-widest">
                  {capture.status === "processing" ? "Transcribing & Slicing" : "Uploading Recordings"}
                </p>
                <BarVisualizer state="thinking" demo barCount={18} minHeight={10} maxHeight={70} centerAlign className="bg-transparent border-0 h-24 rounded-none" />
                <p className="text-center text-xs text-muted-foreground">
                  {capture.status === "processing"
                    ? "Gemini is transcribing audio and generating clips\u2026"
                    : "Uploading recordings to storage \u2014 usually 10\u201330s"}
                </p>
              </div>
            </div>
          )}

          {/* ── Completed — Recordings + Utterances ── */}
          {isCompleted && (
            <>
              {recordingUrl && (
                <WaveformPlayer
                  url={recordingUrl}
                  label="Mixed \u2014 both participants"
                  accentColor="#a1a1aa"
                  onDurationLoaded={setAudioDuration}
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recordingUrlA && (
                  <WaveformPlayer
                    url={recordingUrlA}
                    label={`A \u2014 ${capture.phoneA}`}
                    accentColor={participantColor.a}
                  />
                )}
                {recordingUrlB && (
                  <WaveformPlayer
                    url={recordingUrlB}
                    label={`B \u2014 ${capture.phoneB}`}
                    accentColor={participantColor.b}
                  />
                )}
              </div>

              {/* Mobile CSV download (hidden on desktop where it's in action bar) */}
              {datasetCsvProxyUrl && (
                <a href={datasetCsvProxyUrl} download className="sm:hidden inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <Download className="size-3.5" />
                  Download CSV
                </a>
              )}

              {hasUtterances && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                      Utterances
                    </p>
                    {datasetCsvProxyUrl && (
                      <a href={datasetCsvProxyUrl} download className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                        <Download className="size-3" />
                        CSV
                      </a>
                    )}
                  </div>

                  <Tabs defaultValue="a">
                    <TabsList variant="line" className="w-full overflow-x-auto">
                      <TabsTrigger value="a" className="min-w-0">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: participantColor.a }} />
                        <span className="truncate">A {"\u00B7"} <span className="hidden sm:inline">{capture.phoneA} </span>({utterancesA.length})</span>
                      </TabsTrigger>
                      <TabsTrigger value="b" className="min-w-0">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: participantColor.b }} />
                        <span className="truncate">B {"\u00B7"} <span className="hidden sm:inline">{capture.phoneB} </span>({utterancesB.length})</span>
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="a">
                      <UtteranceList utterances={utterancesA} color={participantColor.a} />
                    </TabsContent>
                    <TabsContent value="b">
                      <UtteranceList utterances={utterancesB} color={participantColor.b} />
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </>
          )}

          {/* ── Metadata ── */}
          {!isPreCall && !callFailed && (
            <div className="flex flex-wrap gap-x-4 sm:gap-x-6 gap-y-2 text-sm pt-2 border-t border-border">
              {[
                { label: "Duration", value: audioDuration != null ? fmt(Math.round(audioDuration)) : fmt(capture.durationSeconds) },
                { label: "Language", value: capture.language || "\u2014" },
                { label: "Created", value: new Date(capture.createdAt).toLocaleDateString() },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="text-xs font-mono">{value}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </>
  );
}
