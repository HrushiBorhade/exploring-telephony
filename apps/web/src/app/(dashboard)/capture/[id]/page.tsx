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
import { motion, AnimatePresence } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
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
  happy:   "text-emerald-600 dark:text-emerald-400",
  sad:     "text-blue-600 dark:text-blue-400",
  angry:   "text-red-600 dark:text-red-400",
  neutral: "text-muted-foreground",
};

const statusConfig: Record<string, { label: string; badgeClass: string; dot: string; pulse?: boolean }> = {
  created:    { label: "Ready",            badgeClass: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",          dot: "bg-zinc-400" },
  calling:    { label: "Calling...",       badgeClass: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-900",    dot: "bg-yellow-500 dark:bg-yellow-400", pulse: true },
  active:     { label: "In Call",          badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500 dark:bg-emerald-400", pulse: true },
  ended:      { label: "Processing...",    badgeClass: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",          dot: "bg-blue-500 dark:bg-blue-400", pulse: true },
  processing: { label: "Transcribing...",  badgeClass: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-900",    dot: "bg-purple-500 dark:bg-purple-400", pulse: true },
  completed:  { label: "Recording Ready",  badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500 dark:bg-emerald-400" },
  failed:     { label: "Failed",           badgeClass: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",             dot: "bg-red-500 dark:bg-red-400" },
};

const fadeUp = pageFadeUp;
const stagger = pageStagger;

function DetailSkeleton() {
  return (
    <>
      <div className="flex items-center justify-between px-4 lg:px-6 py-3 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <div className="space-y-1.5 min-w-0">
            <Skeleton className="h-4 w-40 skeleton-shimmer" />
            <Skeleton className="h-3 w-56 skeleton-shimmer" />
          </div>
        </div>
        <Skeleton className="h-6 w-28 rounded-full shrink-0 skeleton-shimmer" />
      </div>
      <div className="flex-1 flex items-center justify-center p-4 lg:p-6">
        <div className="w-full max-w-3xl space-y-4">
          <Skeleton className="h-40 w-full rounded-xl skeleton-shimmer" />
          <Skeleton className="h-24 w-full rounded-xl skeleton-shimmer" />
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

const UtteranceRow = memo(function UtteranceRow({
  u,
  color,
  index,
}: {
  u: Utterance;
  color: string;
  index: number;
}) {
  const emoCls = emotionClassName[u.emotion] ?? emotionClassName.neutral;
  return (
    <div
      className="group rounded-lg px-2 py-2 transition-colors hover:bg-muted/40"
      style={{
        animation: "fade-in-up 0.3s ease-out backwards",
        animationDelay: `${index * 30}ms`,
      }}
    >
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-mono text-muted-foreground shrink-0 tabular-nums mt-0.5 leading-tight">
          {fmtTimestamp(u.start)}&ndash;{fmtTimestamp(u.end)}
        </span>
        <span className="flex-1 text-sm leading-relaxed min-w-0 break-words">{u.text}</span>
        <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
          <span className={`text-[10px] ${emoCls}`}>{u.emotion}</span>
          <span className="text-[10px] text-muted-foreground uppercase">{u.language}</span>
        </div>
      </div>
      {u.audioUrl && (
        <div className="mt-1.5 ml-0">
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
        <UtteranceRow key={`${i}-${u.start}-${u.end}`} u={u} color={color} index={i} />
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
        <motion.div
          className="max-w-sm text-center space-y-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <p className="font-medium">Failed to load capture</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => router.push("/capture")}>Back</Button>
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!capture) return <DetailSkeleton />;

  const callFailed = capture.status === "ended" && !capture.startedAt;
  const cfg = callFailed
    ? { label: "Call Failed", badgeClass: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900", dot: "bg-red-500 dark:bg-red-400" }
    : (statusConfig[capture.status] ?? statusConfig.created);

  const isCompleted = capture.status === "completed";
  const isPreCall = capture.status === "created" || capture.status === "calling" || capture.status === "active";
  const isProcessing = capture.status === "processing" || (capture.status === "ended" && capture.startedAt);

  return (
    <>
      {/* ── Action bar ─────────────────────────────── */}
      <motion.div
        className="flex items-center justify-between px-4 lg:px-6 py-3 border-b gap-2"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold font-heading tracking-tight truncate">{capture.name || "Untitled"}</h1>
            <p className="text-[11px] sm:text-xs text-muted-foreground font-mono truncate">
              {capture.phoneA} {"\u2194"} {capture.phoneB}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {isCompleted && datasetCsvProxyUrl && (
            <a href={datasetCsvProxyUrl} download className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Download className="size-3.5" />
              <span className="hidden sm:inline">CSV</span>
            </a>
          )}

          <Badge variant="outline" className={`${cfg.badgeClass} whitespace-nowrap transition-colors duration-300 text-[10px] sm:text-xs`}>
            <span className={`mr-1 inline-block size-1.5 rounded-full transition-colors duration-300 ${cfg.dot}${cfg.pulse ? " animate-pulse" : ""}`} />
            {cfg.label}
          </Badge>

          {capture.status === "created" && (
            <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
              {startMutation.isPending
                ? <><LoaderCircle className="size-4 animate-spin" /> <span className="hidden sm:inline">Starting...</span></>
                : <><span className="sm:hidden">Start</span><span className="hidden sm:inline">Start Call</span></>}
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
                ? <><LoaderCircle className="size-4 animate-spin" /> <span className="hidden sm:inline">Ending...</span></>
                : <><span className="sm:hidden">End</span><span className="hidden sm:inline">End Call</span></>}
            </Button>
          )}
        </div>
      </motion.div>

      {/* ── Body ───────────────────────────────────── */}
      <div className={`flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 ${isCompleted ? "max-w-4xl mx-auto w-full" : "flex items-center justify-center"}`}>
        <motion.div
          className={`w-full ${isCompleted ? "" : "max-w-lg"} space-y-3 sm:space-y-4`}
          initial="hidden"
          animate="visible"
          variants={stagger}
        >

          {/* ── Pre-call / In-call states ── */}
          <AnimatePresence mode="wait">
            {isPreCall && (
              <motion.div
                key={capture.status}
                className="rounded-xl border border-border overflow-hidden"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.3 }}
              >
                {capture.status === "created" && (
                  <div className="p-6 sm:p-8 text-center text-muted-foreground text-sm">
                    Click &quot;Start Call&quot; to bridge both phones and begin recording.
                  </div>
                )}

                {capture.status === "calling" && (
                  <div className="p-4 sm:p-6 space-y-3">
                    <p className="text-center text-xs font-medium text-yellow-700 dark:text-yellow-400 uppercase tracking-widest">Dialling</p>
                    <BarVisualizer state="connecting" demo barCount={18} minHeight={15} maxHeight={90} centerAlign className="bg-transparent border-0 h-20 sm:h-24 rounded-none" />
                    <p className="text-center text-[11px] sm:text-xs text-muted-foreground truncate">Calling {capture.phoneA} and {capture.phoneB}{"\u2026"}</p>
                  </div>
                )}

                {capture.status === "active" && (
                  <div className="p-4 sm:p-6 space-y-3">
                    <p className="text-center text-xs font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">Recording</p>
                    <BarVisualizer state="speaking" demo barCount={18} minHeight={10} maxHeight={95} centerAlign className="bg-transparent border-0 h-20 sm:h-24 rounded-none" />
                    <p className="text-center text-[11px] sm:text-xs text-muted-foreground">Both parties connected {"\u00B7"} recording in progress</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Call failed ── */}
          {callFailed && (
            <motion.div
              variants={fadeUp}
              className="rounded-xl border border-border p-6 sm:p-8 text-center space-y-3"
            >
              <p className="text-xs font-medium text-red-700 dark:text-red-400 uppercase tracking-widest">Call Failed</p>
              <p className="text-sm text-muted-foreground">One or both phones didn&apos;t answer. Check the numbers and try again.</p>
              <Button size="sm" variant="outline" onClick={() => router.push("/capture")}>Back to Dashboard</Button>
            </motion.div>
          )}

          {/* ── Processing / Transcribing ── */}
          {isProcessing && (
            <motion.div
              variants={fadeUp}
              className="rounded-xl border border-border overflow-hidden"
            >
              <div className="p-4 sm:p-6 space-y-3">
                <p className="text-center text-xs font-medium text-purple-700 dark:text-purple-400 uppercase tracking-widest">
                  {capture.status === "processing" ? "Transcribing & Slicing" : "Uploading Recordings"}
                </p>
                <BarVisualizer state="thinking" demo barCount={18} minHeight={10} maxHeight={70} centerAlign className="bg-transparent border-0 h-20 sm:h-24 rounded-none" />
                <p className="text-center text-[11px] sm:text-xs text-muted-foreground">
                  {capture.status === "processing"
                    ? "Gemini is transcribing audio and generating clips\u2026"
                    : "Uploading recordings to storage \u2014 usually 10\u201330s"}
                </p>
              </div>
            </motion.div>
          )}

          {/* ── Completed — Recordings + Utterances ── */}
          {isCompleted && (
            <>
              <motion.div variants={fadeUp}>
                {recordingUrl && (
                  <WaveformPlayer
                    url={recordingUrl}
                    label="Mixed — both participants"
                    accentColor="#a1a1aa"
                    onDurationLoaded={setAudioDuration}
                  />
                )}
              </motion.div>

              {(recordingUrlA || recordingUrlB) && (
                <motion.div variants={fadeUp} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {recordingUrlA && (
                    <WaveformPlayer
                      url={recordingUrlA}
                      label={`A — ${capture.phoneA}`}
                      accentColor={participantColor.a}
                    />
                  )}
                  {recordingUrlB && (
                    <WaveformPlayer
                      url={recordingUrlB}
                      label={`B — ${capture.phoneB}`}
                      accentColor={participantColor.b}
                    />
                  )}
                </motion.div>
              )}

              {hasUtterances && (
                <motion.div variants={fadeUp} className="space-y-1">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                      Utterances
                    </p>
                    {datasetCsvProxyUrl && (
                      <a href={datasetCsvProxyUrl} download className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                        <Download className="size-3" />
                        CSV
                      </a>
                    )}
                  </div>

                  <Tabs defaultValue="a">
                    <TabsList variant="line" className="w-full">
                      <TabsTrigger value="a" className="min-w-0 text-xs sm:text-sm">
                        <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: participantColor.a }} />
                        <span className="truncate">A ({utterancesA.length})</span>
                      </TabsTrigger>
                      <TabsTrigger value="b" className="min-w-0 text-xs sm:text-sm">
                        <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: participantColor.b }} />
                        <span className="truncate">B ({utterancesB.length})</span>
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="a">
                      <UtteranceList utterances={utterancesA} color={participantColor.a} />
                    </TabsContent>
                    <TabsContent value="b">
                      <UtteranceList utterances={utterancesB} color={participantColor.b} />
                    </TabsContent>
                  </Tabs>
                </motion.div>
              )}
            </>
          )}

          {/* ── Metadata ── */}
          {!isPreCall && !callFailed && (
            <motion.div
              variants={fadeUp}
              className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm pt-2 border-t border-border"
            >
              {[
                { label: "Duration", value: audioDuration != null ? fmt(Math.round(audioDuration)) : fmt(capture.durationSeconds) },
                { label: "Language", value: capture.language || "\u2014" },
                { label: "Created", value: new Date(capture.createdAt).toLocaleDateString() },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{label}</span>
                  <span className="text-[11px] font-mono">{value}</span>
                </div>
              ))}
            </motion.div>
          )}

        </motion.div>
      </div>
    </>
  );
}
