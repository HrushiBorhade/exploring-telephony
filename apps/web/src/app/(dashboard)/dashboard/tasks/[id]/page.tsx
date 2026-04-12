"use client";

import { useParams, useRouter } from "next/navigation";
import { LoaderCircle, Download, Pencil, Check, X, Table2, Trash2, AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { BarVisualizer } from "@/components/ui/bar-visualizer";
import { WaveformPlayer } from "@/components/waveform-player";
import { useState, useMemo, useCallback, memo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { toast } from "sonner";
import { useCapture, useStartCapture, useEndCapture, useUpdateTranscript, useVerifyCapture, proxyAudioUrl } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import type { Utterance, ModerationFlag } from "@/lib/types";

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

const participantColor = { a: "#3ea88e", b: "#8b8b96" } as const;

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
  completed:       { label: "Recording Ready",  badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500 dark:bg-emerald-400" },
  pending_review:  { label: "Pending Review",  badgeClass: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",       dot: "bg-amber-500 dark:bg-amber-400" },
  verified:        { label: "Verified",         badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500 dark:bg-emerald-400" },
  failed:          { label: "Failed",           badgeClass: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",             dot: "bg-red-500 dark:bg-red-400" },
};

const fadeUp = pageFadeUp;
const stagger = pageStagger;

function DetailSkeleton() {
  return (
    <>
      <div className="flex items-center justify-between px-4 lg:px-6 py-3 border-b">
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
      flags: u.flags ?? [],
    }));
  } catch {
    return [];
  }
}

interface ConversationTurn {
  participant: "a" | "b";
  utterance: Utterance;
  color: string;
  label: string;
  originalIndex: number;
}

const ConversationBubble = memo(function ConversationBubble({
  turn,
  index,
  onEdit,
  onDelete,
  isSaving,
}: {
  turn: ConversationTurn;
  index: number;
  onEdit?: (participant: "a" | "b", originalIndex: number, text: string) => void;
  onDelete?: (participant: "a" | "b", originalIndex: number, text: string) => void;
  isSaving?: boolean;
}) {
  const isA = turn.participant === "a";
  const emoCls = emotionClassName[turn.utterance.emotion] ?? emotionClassName.neutral;
  const flags = turn.utterance.flags ?? [];
  const highestSeverity = flags.length > 0
    ? (flags.some(f => f.severity === "high") ? "high" : flags.some(f => f.severity === "medium") ? "medium" : "low")
    : null;
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(turn.utterance.text);

  const handleSave = useCallback(() => {
    if (editText.trim() && editText !== turn.utterance.text) {
      onEdit?.(turn.participant, turn.originalIndex, editText.trim());
    }
    setEditing(false);
  }, [editText, turn.utterance.text, turn.participant, turn.originalIndex, onEdit]);

  const handleCancel = useCallback(() => {
    setEditText(turn.utterance.text);
    setEditing(false);
  }, [turn.utterance.text]);

  const handleDelete = useCallback(() => {
    onDelete?.(turn.participant, turn.originalIndex, turn.utterance.text);
  }, [turn.participant, turn.originalIndex, turn.utterance.text, onDelete]);

  const flagBorderCls = highestSeverity === "high"
    ? "border-l-red-500 dark:border-l-red-400"
    : highestSeverity === "medium"
    ? "border-l-amber-500 dark:border-l-amber-400"
    : highestSeverity === "low"
    ? "border-l-yellow-500 dark:border-l-yellow-400"
    : "";

  return (
    <div
      className={`flex gap-2.5 ${isA ? "" : "flex-row-reverse"}`}
      style={{
        animation: "fade-in-up 0.3s ease-out backwards",
        animationDelay: `${index * 40}ms`,
      }}
    >
      {/* Participant indicator */}
      <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
        <div
          className="size-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
          style={{ backgroundColor: turn.color }}
        >
          {turn.participant.toUpperCase()}
        </div>
      </div>

      {/* Bubble */}
      <div className={`max-w-[80%] space-y-1 ${isA ? "" : "items-end"}`}>
        <div
          className={`group relative rounded-2xl px-3 py-2 ${
            isA
              ? "rounded-tl-sm bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/50 dark:border-emerald-800/30"
              : "rounded-tr-sm bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200/50 dark:border-zinc-700/30"
          } ${flags.length > 0 ? `border-l-2 ${flagBorderCls}` : ""} ${editing ? "ring-2 ring-primary/30" : ""}`}
        >
          {editing ? (
            <div className="space-y-1.5">
              <textarea
                className="w-full text-sm leading-snug bg-transparent outline-none resize-none min-h-[2em]"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); } if (e.key === "Escape") handleCancel(); }}
                autoFocus
                rows={2}
              />
              <div className="flex gap-1 justify-end">
                <button onClick={handleCancel} className="p-0.5 rounded hover:bg-muted"><X className="size-3.5 text-muted-foreground" /></button>
                <button onClick={handleSave} className="p-0.5 rounded hover:bg-muted"><Check className="size-3.5 text-emerald-600" /></button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm leading-snug break-words">{turn.utterance.text}</p>
              {(onEdit || onDelete) && !isSaving && (
                <div className="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                  {onEdit && (
                    <button
                      onClick={() => { setEditText(turn.utterance.text); setEditing(true); }}
                      className="p-1 rounded-full bg-background border border-border shadow-sm hover:bg-muted"
                    >
                      <Pencil className="size-3 text-muted-foreground" />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={handleDelete}
                      className="p-1 rounded-full bg-background border border-border shadow-sm hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="size-3 text-muted-foreground hover:text-red-500" />
                    </button>
                  )}
                </div>
              )}
              {isSaving && (
                <div className="absolute -top-1.5 -right-1.5">
                  <div className="p-1 rounded-full bg-background border border-border shadow-sm">
                    <LoaderCircle className="size-3 animate-spin" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Meta row */}
        <div className={`flex items-center gap-2 px-1 flex-wrap ${isA ? "" : "flex-row-reverse"}`}>
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
            {fmtTimestamp(turn.utterance.start)}
          </span>
          <span className={`text-[10px] ${emoCls}`}>{turn.utterance.emotion}</span>
          <span className="text-[10px] text-muted-foreground uppercase">{turn.utterance.language}</span>
          {flags.map((flag, fi) => (
            <TooltipProvider key={fi}>
              <Tooltip>
                <TooltipTrigger
                  className={`inline-flex items-center gap-0.5 text-[9px] font-medium uppercase px-1 py-0.5 rounded cursor-help ${
                    flag.severity === "high"
                      ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400"
                      : flag.severity === "medium"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
                      : "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/60 dark:text-yellow-400"
                  }`}
                >
                  <AlertTriangle className="size-2.5" />
                  {flag.type}
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span className="capitalize font-medium">{flag.severity}</span>: {flag.description}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>

        {/* Audio clip */}
        {turn.utterance.audioUrl && (
          <div className="mt-0.5">
            <WaveformPlayer url={turn.utterance.audioUrl} label="" accentColor={turn.color} />
          </div>
        )}
      </div>
    </div>
  );
});

function ConversationView({ utterancesA, utterancesB, phoneA, phoneB, onEditUtterance, onDeleteUtterance, savingKey }: {
  utterancesA: Utterance[];
  utterancesB: Utterance[];
  phoneA: string;
  phoneB: string;
  onEditUtterance?: (participant: "a" | "b", index: number, text: string) => void;
  onDeleteUtterance?: (participant: "a" | "b", index: number, text: string) => void;
  savingKey?: string | null;
}) {
  const turns = useMemo(() => {
    const all: ConversationTurn[] = [
      ...utterancesA.map((u, i) => ({ participant: "a" as const, utterance: u, color: participantColor.a, label: phoneA, originalIndex: i })),
      ...utterancesB.map((u, i) => ({ participant: "b" as const, utterance: u, color: participantColor.b, label: phoneB, originalIndex: i })),
    ];
    // Sort by start time. For overlapping utterances (same start time),
    // keep the one that started first, then the one that overlaps.
    // This preserves natural conversation order even when people talk over each other.
    return all.sort((a, b) => {
      const diff = a.utterance.start - b.utterance.start;
      if (Math.abs(diff) < 0.01) return a.participant === "a" ? -1 : 1; // Stable tie-break
      return diff;
    });
  }, [utterancesA, utterancesB, phoneA, phoneB]);

  // Detect overlaps: mark turns that overlap with the previous turn
  const overlaps = useMemo(() => {
    const set = new Set<number>();
    for (let i = 1; i < turns.length; i++) {
      const prev = turns[i - 1];
      const curr = turns[i];
      // Overlap: current starts before previous ends AND they're different speakers
      if (curr.utterance.start < prev.utterance.end && curr.participant !== prev.participant) {
        set.add(i);
      }
    }
    return set;
  }, [turns]);

  if (turns.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No utterances detected</p>;
  }

  return (
    <div className="space-y-3 pt-2">
      {turns.map((turn, i) => (
        <div key={`${turn.participant}-${i}-${turn.utterance.start}`}>
          {overlaps.has(i) && (
            <div className="flex items-center gap-2 px-8 -mb-1">
              <div className="flex-1 h-px bg-amber-300/40 dark:bg-amber-600/30" />
              <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium uppercase tracking-wider">overlap</span>
              <div className="flex-1 h-px bg-amber-300/40 dark:bg-amber-600/30" />
            </div>
          )}
          <ConversationBubble
            turn={turn}
            index={i}
            onEdit={onEditUtterance}
            onDelete={onDeleteUtterance}
            isSaving={savingKey === `${turn.participant}-${turn.originalIndex}`}
          />
        </div>
      ))}
    </div>
  );
}

export default function CaptureDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  const { data: capture, isPending, error } = useCapture(id);
  const startMutation = useStartCapture(id);
  const endMutation = useEndCapture(id);
  const transcriptMutation = useUpdateTranscript(id);
  const verifyMutation = useVerifyCapture(id);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [csvData, setCsvData] = useState<string[][] | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvRegenerating, setCsvRegenerating] = useState(false);
  const [pendingCsvReload, setPendingCsvReload] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ participant: "a" | "b"; index: number; text: string } | null>(null);

  const utterancesA = useMemo(() => parseUtterances(capture?.transcriptA, id), [capture?.transcriptA, id]);
  const utterancesB = useMemo(() => parseUtterances(capture?.transcriptB, id), [capture?.transcriptB, id]);
  const hasUtterances = utterancesA.length > 0 || utterancesB.length > 0;

  const flagCount = useMemo(() => {
    let count = 0;
    for (const u of utterancesA) count += (u.flags?.length ?? 0);
    for (const u of utterancesB) count += (u.flags?.length ?? 0);
    return count;
  }, [utterancesA, utterancesB]);

  const displayStatus = capture?.status === "completed"
    ? capture.verified === true ? "verified"
    : capture.verified === false ? "pending_review"
    : "completed"
    : capture?.status ?? "created";

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

  const loadCsv = useCallback(async () => {
    if (!datasetCsvProxyUrl) return;
    setCsvLoading(true);
    try {
      const url = `${datasetCsvProxyUrl}${datasetCsvProxyUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
      const res = await fetch(url, { credentials: "include", redirect: "follow" });
      const text = await res.text();
      const rows = text.split("\n").filter(Boolean).map((row) => {
        const cells: string[] = [];
        let current = "";
        let inQuotes = false;
        for (const ch of row) {
          if (ch === '"') { inQuotes = !inQuotes; }
          else if (ch === "," && !inQuotes) { cells.push(current); current = ""; }
          else { current += ch; }
        }
        cells.push(current);
        return cells;
      });
      setCsvData(rows);
    } catch { setCsvData(null); }
    finally { setCsvLoading(false); }
  }, [datasetCsvProxyUrl]);

  const handleEditUtterance = useCallback((participant: "a" | "b", index: number, text: string) => {
    const key = `${participant}-${index}`;
    setSavingKey(key);
    setCsvRegenerating(true);
    setPendingCsvReload(true);
    transcriptMutation.mutate({ participant, index, text }, {
      onSettled: () => setSavingKey(null),
      onSuccess: () => {
        toast.success("Transcript updated — CSV regenerating...");
      },
      onError: () => { setCsvRegenerating(false); setPendingCsvReload(false); },
    });
  }, [transcriptMutation]);

  const handleDeleteUtterance = useCallback((participant: "a" | "b", index: number, text: string) => {
    setDeleteTarget({ participant, index, text });
  }, []);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    const key = `${deleteTarget.participant}-${deleteTarget.index}`;
    setSavingKey(key);
    setCsvRegenerating(true);
    setPendingCsvReload(true);
    setDeleteTarget(null);
    transcriptMutation.mutate({ participant: deleteTarget.participant, index: deleteTarget.index, action: "delete" }, {
      onSettled: () => setSavingKey(null),
      onSuccess: () => {
        toast.success("Utterance deleted — CSV regenerating...");
      },
      onError: () => { setCsvRegenerating(false); setPendingCsvReload(false); },
    });
  }, [deleteTarget, transcriptMutation]);

  // After edit, wait for CSV worker to finish then reload CSV in Sheet
  useEffect(() => {
    if (!pendingCsvReload) return;
    const timer = setTimeout(async () => {
      if (csvData) await loadCsv();
      setCsvRegenerating(false);
      setPendingCsvReload(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [pendingCsvReload, csvData, loadCsv]);

  if (isPending && !capture) return <DetailSkeleton />;

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
            <Button variant="outline" onClick={() => router.push("/dashboard/tasks")}>Back</Button>
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!capture) return <DetailSkeleton />;

  // A capture "failed" if it ended without any recordings (consent denied, timeout, SIP error, etc.)
  const hasRecordings = !!(capture.recordingUrl || capture.recordingUrlA || capture.recordingUrlB);
  const callFailed = capture.status === "failed" || (capture.status === "ended" && !hasRecordings);
  const cfg = callFailed
    ? { label: "Call Failed", badgeClass: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900", dot: "bg-red-500 dark:bg-red-400" }
    : (statusConfig[displayStatus] ?? statusConfig.created);

  const isCompleted = capture.status === "completed";
  const isPreCall = capture.status === "created" || capture.status === "calling" || capture.status === "active";
  const isProcessing = capture.status === "processing" || (capture.status === "ended" && hasRecordings);

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
            <p className="text-[11px] sm:text-xs text-muted-foreground font-mono truncate">
              {capture.phoneA} {"\u2194"} {capture.phoneB}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {isCompleted && datasetCsvProxyUrl && (
            <Sheet>
              <SheetTrigger render={<Button variant="outline" size="sm" onClick={loadCsv} />}>
                <Table2 className="size-3.5" />
                View CSV
              </SheetTrigger>
              <SheetContent side="right" style={{ maxWidth: "85vw" }}>
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    Dataset CSV
                    {csvRegenerating && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-normal text-amber-600 dark:text-amber-400">
                        <LoaderCircle className="size-3 animate-spin" />
                        Regenerating...
                      </span>
                    )}
                  </SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-auto px-4">
                  {csvLoading ? (
                    <div className="flex items-center justify-center py-12"><LoaderCircle className="size-6 animate-spin text-muted-foreground" /></div>
                  ) : csvData && csvData.length > 1 ? (
                    <div className="border rounded-lg overflow-x-auto">
                      <table className="min-w-max text-[11px]">
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-muted">
                            {csvData[0].map((h, i) => (
                              <th key={i} className="px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap border-b">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csvData.slice(1).map((row, ri) => (
                            <tr key={ri} className="border-t border-border/40 hover:bg-muted/30 transition-colors">
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-3 py-2 whitespace-nowrap max-w-[300px] truncate" title={cell}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-6 text-center">No data available</p>
                  )}
                </div>
                <SheetFooter>
                  {csvRegenerating ? (
                    <Button disabled>
                      <LoaderCircle className="size-3.5 animate-spin" />
                      Regenerating CSV...
                    </Button>
                  ) : (
                    <Button nativeButton={false} render={<a href={datasetCsvProxyUrl} download />}>
                      <Download className="size-3.5" />
                      Download CSV
                    </Button>
                  )}
                </SheetFooter>
              </SheetContent>
            </Sheet>
          )}

          <Badge variant="outline" className={`${cfg.badgeClass} whitespace-nowrap transition-colors duration-300 text-[10px] sm:text-xs`}>
            <span className={`mr-1 inline-block size-1.5 rounded-full transition-colors duration-300 ${cfg.dot}${cfg.pulse ? " animate-pulse" : ""}`} />
            {cfg.label}
          </Badge>

          {isAdmin && capture.verified === false && (
            <Button size="sm" onClick={() => verifyMutation.mutate()} disabled={verifyMutation.isPending}>
              {verifyMutation.isPending
                ? <><LoaderCircle className="size-4 animate-spin" /> Verifying...</>
                : <><ShieldCheck className="size-3.5" /> Verify</>}
            </Button>
          )}
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
              <Button size="sm" variant="outline" onClick={() => router.push("/dashboard/tasks")}>Back to Dashboard</Button>
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
                      label={`Contributor A — ${capture.phoneA}`}
                      accentColor={participantColor.a}
                    />
                  )}
                  {recordingUrlB && (
                    <WaveformPlayer
                      url={recordingUrlB}
                      label={`Contributor B — ${capture.phoneB}`}
                      accentColor={participantColor.b}
                    />
                  )}
                </motion.div>
              )}

              {hasUtterances && (
                <motion.div variants={fadeUp} className="space-y-1">
                  <div className="py-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                      Conversation
                      {flagCount > 0 && (
                        <span className="ml-2 text-amber-600 dark:text-amber-400 normal-case tracking-normal">
                          ({flagCount} flagged)
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ backgroundColor: participantColor.a }} />
                        <span className="text-[10px] text-muted-foreground">A ({utterancesA.length})</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ backgroundColor: participantColor.b }} />
                        <span className="text-[10px] text-muted-foreground">B ({utterancesB.length})</span>
                      </div>
                    </div>
                  </div>

                  <ConversationView
                    utterancesA={utterancesA}
                    utterancesB={utterancesB}
                    phoneA={capture.phoneA}
                    phoneB={capture.phoneB}
                    onEditUtterance={isAdmin ? handleEditUtterance : undefined}
                    onDeleteUtterance={isAdmin ? handleDeleteUtterance : undefined}
                    savingKey={savingKey}
                  />
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

      {/* Delete utterance confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete utterance?</DialogTitle>
            <DialogDescription>
              This will permanently remove this utterance from the transcript and regenerate the CSV.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground line-clamp-3">
              &ldquo;{deleteTarget.text}&rdquo;
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={confirmDelete} disabled={transcriptMutation.isPending}>
              {transcriptMutation.isPending ? (
                <><LoaderCircle className="size-3.5 animate-spin" /> Deleting...</>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
