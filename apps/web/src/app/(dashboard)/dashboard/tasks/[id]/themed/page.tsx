"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import {
  ArrowLeft,
  Copy,
  Check,
  X,
  RefreshCw,
  LoaderCircle,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { BarVisualizer } from "@/components/ui/bar-visualizer";
import { WaveformPlayer } from "@/components/waveform-player";
import { AdminCaptureBanner } from "@/components/admin-capture-banner";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { toast } from "sonner";
import {
  useCapture,
  useStartCapture,
  useEndCapture,
  useThemeSample,
  useValidateThemeForm,
  useResendWhatsApp,
} from "@/lib/api";
import { ConversationView, parseUtterances, participantColor } from "@/components/conversation-view";
import type { Utterance } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────

interface ValidationResult {
  results: { field: string; submitted: string; correct: boolean }[];
  score: number;
  total: number;
  allCorrect: boolean;
}

// ── Constants ──────────────────────────────────────────────────────

const MAX_ATTEMPTS = 10;

const LANG_LABELS: Record<string, string> = {
  hindi: "\u0939\u093F\u0928\u094D\u0926\u0940",
  telugu: "\u0C24\u0C46\u0C32\u0C41\u0C17\u0C41",
};

const LANG_HINTS: Record<string, string> = {
  hindi: "\u0939\u093F\u0928\u094D\u0926\u0940 \u092E\u0947\u0902 \u092E\u0942\u0932\u094D\u092F \u0926\u0930\u094D\u091C \u0915\u0930\u0947\u0902",
  telugu: "\u0C24\u0C46\u0C32\u0C41\u0C17\u0C41\u0C32\u0C4B \u0C35\u0C3F\u0C32\u0C41\u0C35\u0C32\u0C41 \u0C28\u0C2E\u0C4B\u0C26\u0C41 \u0C1A\u0C47\u0C2F\u0C02\u0C21\u0C3F",
};

const statusConfig: Record<
  string,
  { label: string; badgeClass: string; dot: string; pulse?: boolean }
> = {
  created: {
    label: "Ready",
    badgeClass:
      "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
    dot: "bg-zinc-400",
  },
  calling: {
    label: "Dialing Phones...",
    badgeClass:
      "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-900",
    dot: "bg-yellow-500 dark:bg-yellow-400",
    pulse: true,
  },
  active: {
    label: "Recording",
    badgeClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
    dot: "bg-emerald-500 dark:bg-emerald-400",
    pulse: true,
  },
  ended: {
    label: "Saving Recordings...",
    badgeClass:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
    dot: "bg-blue-500 dark:bg-blue-400",
    pulse: true,
  },
  processing: {
    label: "Transcribing...",
    badgeClass:
      "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-900",
    dot: "bg-purple-500 dark:bg-purple-400",
    pulse: true,
  },
  completed: {
    label: "Completed",
    badgeClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
    dot: "bg-emerald-500 dark:bg-emerald-400",
  },
  failed: {
    label: "Failed",
    badgeClass:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
    dot: "bg-red-500 dark:bg-red-400",
  },
};

const fadeUp = pageFadeUp;
const stagger = pageStagger;

// ── Loading skeleton ───────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Header bar skeleton */}
      <div className="flex items-center gap-3 border-b px-3 sm:px-4 lg:px-6 py-2 sm:py-3">
        <Skeleton className="size-8 rounded" />
        <Skeleton className="h-4 w-32" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      </div>

      <div className="flex-1 p-2 sm:p-4 lg:p-6 space-y-4 max-w-2xl">
        {/* Instructions card skeleton */}
        <div className="rounded-xl border p-4 space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-5/6" />
        </div>

        {/* Share section skeleton */}
        <div className="rounded-xl border p-4 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-full rounded" />
          <Skeleton className="h-8 w-24" />
        </div>

        {/* Checkboxes skeleton */}
        <div className="rounded-xl border p-4 space-y-3">
          <Skeleton className="h-4 w-32" />
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>

        {/* Form fields skeleton */}
        <div className="rounded-xl border p-4 space-y-4">
          <Skeleton className="h-4 w-20" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────

export default function ThemedCaptureDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  // ── Data hooks ──
  const { data: capture, isPending: captureLoading, error: captureError } = useCapture(id);
  const { data: theme, isPending: themeLoading } = useThemeSample(id);
  const startMutation = useStartCapture(id);
  const endMutation = useEndCapture(id);
  const validateMutation = useValidateThemeForm(id);
  const resendMutation = useResendWhatsApp(id);

  // ── Local state ──
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [sharedConfirm, setSharedConfirm] = useState(false);
  const [understoodConfirm, setUnderstoodConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState(0);

  // ── Derived values ──
  const status = capture?.status ?? "created";
  const hasRecordings = !!(capture?.recordingUrl || capture?.recordingUrlA || capture?.recordingUrlB);
  const callFailed = status === "failed" || (status === "ended" && !hasRecordings);
  const isPreCall = status === "created";
  const isCalling = status === "calling";
  const isRecording = status === "active";
  const isCallActive = isCalling || isRecording;
  const isPostCall = !callFailed && ["ended", "processing", "completed"].includes(status);
  const canStartCall = sharedConfirm && understoodConfirm && (isPreCall || callFailed);
  const formFields = theme ? Object.keys(theme.data) : [];
  const publicUrl = theme?.publicToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/t/${theme.publicToken}`
    : null;

  const cfg = callFailed
    ? statusConfig.failed
    : (statusConfig[status] ?? statusConfig.created);

  const recordingUrl = capture?.recordingUrl ?? null;
  const recordingUrlA = capture?.recordingUrlA ?? null;
  const recordingUrlB = capture?.recordingUrlB ?? null;

  const utterancesA = useMemo(() => parseUtterances(capture?.transcriptA, id), [capture?.transcriptA, id]);
  const utterancesB = useMemo(() => parseUtterances(capture?.transcriptB, id), [capture?.transcriptB, id]);
  const hasUtterances = utterancesA.length > 0 || utterancesB.length > 0;

  // ── Handlers ──

  function handleCopyLink() {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleStartCall() {
    startMutation.mutate();
  }

  function handleEndCall() {
    endMutation.mutate();
  }

  function handleFieldChange(field: string, value: string) {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  }

  function handleValidate() {
    if (attemptsUsed >= MAX_ATTEMPTS) {
      toast.error("Maximum attempts reached");
      return;
    }
    validateMutation.mutate(formValues, {
      onSuccess: (data) => {
        setValidationResult(data);
        setAttemptsUsed((prev) => prev + 1);
        if (data.allCorrect) {
          toast.success("All values correct!");
        } else {
          toast.info(
            `${data.score}/${data.total} correct. Ask Participant B again for incorrect values.`,
          );
        }
      },
    });
  }

  function handleResendWhatsApp() {
    resendMutation.mutate();
  }

  // ── Field validation lookup ──
  function getFieldResult(field: string) {
    if (!validationResult) return null;
    return validationResult.results.find((r) => r.field === field) ?? null;
  }

  // ── Loading ──
  if ((captureLoading || themeLoading) && !capture) {
    return <DetailSkeleton />;
  }

  // ── Error ──
  if (captureError && !capture) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <motion.div
          className="max-w-sm space-y-4 text-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <p className="font-medium">Failed to load capture</p>
          <p className="text-sm text-muted-foreground">{captureError.message}</p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => router.push("/dashboard/tasks")}>
              Back
            </Button>
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!capture) return <DetailSkeleton />;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Admin viewing another user's capture */}
      <AdminCaptureBanner captureUserId={capture.userId} capturePhoneA={capture.phoneA} />

      {/* ── Header bar ─────────────────────────────── */}
      <motion.div
        className="flex items-center justify-between gap-2 border-b px-3 sm:px-4 lg:px-6 py-2 sm:py-3"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/dashboard/tasks")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              Themed Capture
              {theme?.category && (
                <span className="ml-1.5 text-muted-foreground font-normal">
                  {"\u00B7"} {theme.category.replace(/_/g, " ")}
                </span>
              )}
            </p>
            <p className="text-[11px] text-muted-foreground font-mono truncate">
              {capture.phoneA} {"\u2194"} {capture.phoneB}
            </p>
          </div>
        </div>

        <Badge
          variant="outline"
          className={`${cfg.badgeClass} whitespace-nowrap transition-colors duration-300 text-[10px] sm:text-xs`}
        >
          <span
            className={`mr-1 inline-block size-1.5 rounded-full transition-colors duration-300 ${cfg.dot}${cfg.pulse ? " animate-pulse" : ""}`}
          />
          {cfg.label}
        </Badge>
      </motion.div>

      {/* ── Body ───────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-4 lg:p-6">
        <motion.div
          className="mx-auto w-full max-w-2xl space-y-4"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          {/* ══════════════════════════════════════════
              Phase 1: Setup (status = "created")
             ══════════════════════════════════════════ */}
          {isPreCall && (
            <>
              {/* Instructions */}
              <motion.div variants={fadeUp}>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Info className="size-4 text-blue-500" />
                      Instructions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      You are <strong>Participant A</strong> (the receptionist).
                      Participant B will call you and read out values from a form.
                      Your job is to listen carefully and fill in each field below.
                    </p>
                    <ol className="list-decimal list-inside space-y-1 text-[13px]">
                      <li>Share the WhatsApp link below with Participant B</li>
                      <li>
                        Make sure they have received the form data on their phone
                      </li>
                      <li>Check both readiness boxes, then start the call</li>
                      <li>
                        Listen to Participant B and type the values you hear into the
                        form
                      </li>
                    </ol>
                  </CardContent>
                </Card>
              </motion.div>

              {/* WhatsApp / Public link */}
              <motion.div variants={fadeUp}>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      Share with Participant B
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {publicUrl ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 truncate rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">
                          {publicUrl}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCopyLink}
                          className="shrink-0"
                        >
                          {copied ? (
                            <Check className="size-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                          {copied ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    ) : (
                      <Skeleton className="h-10 w-full" />
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleResendWhatsApp}
                      disabled={resendMutation.isPending}
                    >
                      {resendMutation.isPending ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Resend WhatsApp
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Readiness checkboxes */}
              <motion.div variants={fadeUp}>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Readiness Check</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <Checkbox
                        checked={sharedConfirm}
                        onCheckedChange={(val) => setSharedConfirm(!!val)}
                      />
                      <span className="text-sm leading-snug">
                        I have shared the link with Participant B and they have
                        received the form data
                      </span>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <Checkbox
                        checked={understoodConfirm}
                        onCheckedChange={(val) => setUnderstoodConfirm(!!val)}
                      />
                      <span className="text-sm leading-snug">
                        I understand my role as the receptionist and will fill in
                        the form as Participant B reads out the values
                      </span>
                    </label>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Empty form preview */}
              <motion.div variants={fadeUp}>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      Form Fields
                      {theme?.language && LANG_LABELS[theme.language] && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          ({LANG_LABELS[theme.language]})
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {formFields.length > 0 ? (
                      <div className="grid gap-3">
                        {formFields.map((field) => (
                          <div key={field} className="grid gap-1.5">
                            <Label className="text-xs font-medium text-muted-foreground">
                              {field}
                            </Label>
                            <Input
                              placeholder="Fill during call"
                              disabled
                              className="bg-muted/30"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Skeleton className="h-20 w-full" />
                    )}
                  </CardContent>
                </Card>
              </motion.div>

              {/* Start Call button */}
              <motion.div variants={fadeUp} className="flex justify-center pt-2">
                <Button
                  size="lg"
                  onClick={handleStartCall}
                  disabled={!canStartCall || startMutation.isPending}
                  className="w-full sm:w-auto sm:min-w-[180px]"
                >
                  {startMutation.isPending ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    "Start Call"
                  )}
                </Button>
              </motion.div>
            </>
          )}

          {/* ══════════════════════════════════════════
              Phase 2: Active Call (calling / active)
             ══════════════════════════════════════════ */}
          {isCallActive && (
            <>
              {/* Recording status bar */}
              <motion.div
                variants={fadeUp}
                className="rounded-xl border border-border overflow-hidden"
              >
                <div className="p-4 sm:p-6 space-y-3">
                  <p
                    className={`text-center text-xs font-medium uppercase tracking-widest ${
                      status === "calling"
                        ? "text-yellow-700 dark:text-yellow-400"
                        : "text-emerald-700 dark:text-emerald-400"
                    }`}
                  >
                    {status === "calling" ? "Dialing Phones" : "Recording"}
                  </p>
                  <BarVisualizer
                    state={status === "calling" ? "connecting" : "speaking"}
                    demo
                    barCount={18}
                    minHeight={status === "calling" ? 15 : 10}
                    maxHeight={status === "calling" ? 90 : 95}
                    centerAlign
                    className="h-20 rounded-none border-0 bg-transparent sm:h-24"
                  />
                  <p className="text-center text-[11px] text-muted-foreground sm:text-xs">
                    {status === "calling"
                      ? `Connecting ${capture.phoneA} and ${capture.phoneB} \u2014 waiting for consent`
                      : "Both parties connected \u00B7 recording in progress"}
                  </p>
                </div>
              </motion.div>

              {/* End Call button (only when active) */}
              {status === "active" && (
                <motion.div
                  variants={fadeUp}
                  className="flex justify-center"
                >
                  <Button
                    variant="destructive"
                    size="lg"
                    onClick={handleEndCall}
                    disabled={endMutation.isPending}
                    className="w-full sm:w-auto sm:min-w-[180px]"
                  >
                    {endMutation.isPending ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        Ending...
                      </>
                    ) : (
                      "End Call"
                    )}
                  </Button>
                </motion.div>
              )}

              {/* Language hint */}
              {theme?.language && LANG_HINTS[theme.language] && (
                <motion.div variants={fadeUp}>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-center text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                    {LANG_HINTS[theme.language]}
                  </div>
                </motion.div>
              )}

              {/* Fillable form */}
              <motion.div variants={fadeUp}>
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">
                        Fill in the Form
                        {theme?.language && LANG_LABELS[theme.language] && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            ({LANG_LABELS[theme.language]})
                          </span>
                        )}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {validationResult && (
                          <Badge
                            variant="outline"
                            className={
                              validationResult.allCorrect
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
                                : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
                            }
                          >
                            {validationResult.score}/{validationResult.total}{" "}
                            correct
                          </Badge>
                        )}
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {attemptsUsed}/{MAX_ATTEMPTS} attempts
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {formFields.length > 0 ? (
                      <div className="grid gap-3">
                        {formFields.map((field) => {
                          const result = getFieldResult(field);
                          const borderClass = result
                            ? result.correct
                              ? "border-emerald-500 focus-visible:ring-emerald-500/30"
                              : "border-red-500 focus-visible:ring-red-500/30"
                            : "";

                          return (
                            <div key={field} className="grid gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-xs font-medium text-muted-foreground">
                                  {field}
                                </Label>
                                {result &&
                                  (result.correct ? (
                                    <Check className="size-3.5 text-emerald-600" />
                                  ) : (
                                    <X className="size-3.5 text-red-500" />
                                  ))}
                              </div>
                              <Input
                                value={formValues[field] ?? ""}
                                onChange={(e) =>
                                  handleFieldChange(field, e.target.value)
                                }
                                placeholder={`Enter ${field}`}
                                className={borderClass}
                                disabled={
                                  validationResult?.allCorrect ||
                                  attemptsUsed >= MAX_ATTEMPTS
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <Skeleton className="h-20 w-full" />
                    )}

                    {/* Validation feedback message */}
                    {validationResult && !validationResult.allCorrect && (
                      <p className="text-sm text-amber-700 dark:text-amber-400">
                        Ask Participant B again for incorrect values
                      </p>
                    )}
                    {validationResult?.allCorrect && (
                      <p className="text-sm text-emerald-700 dark:text-emerald-400">
                        All values correct! Great job.
                      </p>
                    )}

                    {/* Validate button */}
                    <div className="flex justify-end">
                      <Button
                        onClick={handleValidate}
                        disabled={
                          validateMutation.isPending ||
                          validationResult?.allCorrect ||
                          attemptsUsed >= MAX_ATTEMPTS ||
                          formFields.length === 0
                        }
                      >
                        {validateMutation.isPending ? (
                          <>
                            <LoaderCircle className="size-4 animate-spin" />
                            Validating...
                          </>
                        ) : (
                          "Validate Form"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </>
          )}

          {/* ══════════════════════════════════════════
              Call Failed — retry option
             ══════════════════════════════════════════ */}
          {callFailed && (
            <motion.div variants={fadeUp}>
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:p-6 space-y-3 text-center">
                <p className="text-sm font-medium text-destructive">
                  Call Failed
                </p>
                <p className="text-xs text-muted-foreground">
                  The call could not be completed. This may be due to phones not answering, consent not being given, or a connection issue.
                </p>
                <Button
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                  className="gap-2"
                >
                  {startMutation.isPending ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      Retrying...
                    </>
                  ) : (
                    "Retry Call"
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {/* ══════════════════════════════════════════
              Phase 3: Post-Call (ended / processing / completed)
             ══════════════════════════════════════════ */}
          {isPostCall && (
            <>
              {/* Processing indicator */}
              {(status === "ended" || status === "processing") && (
                <motion.div
                  variants={fadeUp}
                  className="rounded-xl border border-border overflow-hidden"
                >
                  <div className="p-4 sm:p-6 space-y-3">
                    <p className="text-center text-xs font-medium text-purple-700 uppercase tracking-widest dark:text-purple-400">
                      {status === "processing"
                        ? "Transcribing & Slicing"
                        : "Saving Recordings"}
                    </p>
                    <BarVisualizer
                      state="thinking"
                      demo
                      barCount={18}
                      minHeight={10}
                      maxHeight={70}
                      centerAlign
                      className="h-20 rounded-none border-0 bg-transparent sm:h-24"
                    />
                    <p className="text-center text-[11px] text-muted-foreground sm:text-xs">
                      {status === "processing"
                        ? "Generating transcripts, audio clips and dataset CSV\u2026"
                        : "Uploading recordings to storage \u2014 usually takes 10\u201330s"}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Read-only form with final values and validation */}
              <motion.div variants={fadeUp}>
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">
                        Form Results
                        {theme?.language && LANG_LABELS[theme.language] && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            ({LANG_LABELS[theme.language]})
                          </span>
                        )}
                      </CardTitle>
                      {validationResult && (
                        <Badge
                          variant="outline"
                          className={
                            validationResult.allCorrect
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
                              : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
                          }
                        >
                          {validationResult.score}/{validationResult.total}{" "}
                          correct
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {formFields.length > 0 ? (
                      <div className="grid gap-3">
                        {formFields.map((field) => {
                          const result = getFieldResult(field);
                          const borderClass = result
                            ? result.correct
                              ? "border-emerald-500/50"
                              : "border-red-500/50"
                            : "";

                          return (
                            <div key={field} className="grid gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-xs font-medium text-muted-foreground">
                                  {field}
                                </Label>
                                {result &&
                                  (result.correct ? (
                                    <Check className="size-3.5 text-emerald-600" />
                                  ) : (
                                    <X className="size-3.5 text-red-500" />
                                  ))}
                              </div>
                              <Input
                                value={formValues[field] ?? ""}
                                readOnly
                                className={`bg-muted/30 ${borderClass}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <Skeleton className="h-20 w-full" />
                    )}

                    {/* Score summary */}
                    {validationResult && (
                      <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-center">
                        <p className="text-lg font-semibold tabular-nums">
                          {validationResult.score}/{validationResult.total}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {validationResult.allCorrect
                            ? "All fields matched correctly"
                            : `${validationResult.total - validationResult.score} field(s) did not match`}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Attempts used: {attemptsUsed}/{MAX_ATTEMPTS}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>

              {/* Recordings — same layout as general capture page */}
              {status === "completed" && (
                <>
                  {recordingUrl && (
                    <motion.div variants={fadeUp}>
                      <WaveformPlayer
                        url={recordingUrl}
                        label="Mixed — both participants"
                        accentColor="#a1a1aa"
                      />
                    </motion.div>
                  )}

                  {(recordingUrlA || recordingUrlB) && (
                    <motion.div variants={fadeUp} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {recordingUrlA && (
                        <WaveformPlayer
                          url={recordingUrlA}
                          label={`Contributor A — ${capture.phoneA}`}
                          accentColor="#3ea88e"
                        />
                      )}
                      {recordingUrlB && (
                        <WaveformPlayer
                          url={recordingUrlB}
                          label={`Contributor B — ${capture.phoneB}`}
                          accentColor="#8b8b96"
                        />
                      )}
                    </motion.div>
                  )}

                  {hasUtterances && (
                    <motion.div variants={fadeUp} className="space-y-1">
                      <div className="py-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                          Conversation
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
                      />
                    </motion.div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── Metadata footer ── */}
          {!isPreCall && (
            <motion.div
              variants={fadeUp}
              className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3 text-sm"
            >
              {[
                {
                  label: "Category",
                  value: theme?.category?.replace(/_/g, " ") ?? "\u2014",
                },
                {
                  label: "Language",
                  value: theme?.language
                    ? `${theme.language}${LANG_LABELS[theme.language] ? ` (${LANG_LABELS[theme.language]})` : ""}`
                    : "\u2014",
                },
                {
                  label: "Created",
                  value: new Date(capture.createdAt).toLocaleDateString(),
                },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    {label}
                  </span>
                  <span className="text-[11px] font-mono capitalize">
                    {value}
                  </span>
                </div>
              ))}
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
