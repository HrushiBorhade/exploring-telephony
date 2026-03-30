"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import type { Capture } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
  created: { label: "Ready", color: "bg-zinc-700 text-zinc-300", dot: "bg-zinc-400" },
  calling: { label: "Calling...", color: "bg-yellow-900 text-yellow-300", dot: "bg-yellow-400 animate-pulse" },
  active: { label: "In Call", color: "bg-green-900 text-green-300", dot: "bg-green-400 animate-pulse" },
  ended: { label: "Processing...", color: "bg-blue-900 text-blue-300", dot: "bg-blue-400 animate-pulse" },
  completed: { label: "Recording Ready", color: "bg-emerald-900 text-emerald-300", dot: "bg-emerald-400" },
};

// --- Loading skeleton for the detail page ---
function DetailSkeleton() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header skeleton */}
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-14" />
          <Separator orientation="vertical" className="h-6" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-8 w-24" />
        </div>
      </header>

      {/* Body skeleton */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-lg space-y-6">
          <Card>
            <CardContent className="py-6 space-y-4">
              <div className="flex flex-col items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// --- Error state when capture fails to load ---
function DetailError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardContent className="py-12 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
            <span className="text-destructive text-xl">!</span>
          </div>
          <div>
            <p className="font-medium">Failed to load capture</p>
            <p className="text-sm text-muted-foreground mt-1">{message}</p>
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => window.location.href = "/capture"}>
              Back to Dashboard
            </Button>
            <Button onClick={onRetry}>
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CaptureDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [capture, setCapture] = useState<Capture | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startingCall, setStartingCall] = useState(false);
  const [endingCall, setEndingCall] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/captures/${id}`);
      if (res.ok) {
        setCapture(await res.json());
        setLoadError(null);
      } else if (res.status === 404) {
        toast.error("Capture not found");
        router.push("/capture");
        return;
      } else {
        const errText = await res.text().catch(() => "Unknown error");
        setLoadError(`Server returned ${res.status}: ${errText}`);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Network error — is the API server running?");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  // Poll for status updates
  useEffect(() => {
    load();
    const i = setInterval(load, 3000);
    return () => clearInterval(i);
  }, [load]);

  async function startCall() {
    setStartingCall(true);

    // Optimistic update: immediately show "calling" status
    setCapture((prev) =>
      prev ? { ...prev, status: "calling" } : prev
    );

    try {
      const res = await fetch(`${API}/api/captures/${id}/start`, { method: "POST" });
      if (res.ok) {
        toast.success("Calling both phones...");
        // Refresh to get server-confirmed state
        load();
      } else {
        // Revert optimistic update on failure
        const body = await res.json().catch(() => ({ error: "Failed to start call" }));
        toast.error(body.error || "Failed to start call");
        setCapture((prev) =>
          prev ? { ...prev, status: "created" } : prev
        );
      }
    } catch (err) {
      // Revert optimistic update on network error
      toast.error(err instanceof Error ? err.message : "Network error — could not start call");
      setCapture((prev) =>
        prev ? { ...prev, status: "created" } : prev
      );
    } finally {
      setStartingCall(false);
    }
  }

  async function endCall() {
    setEndingCall(true);

    // Save current status for potential revert
    const previousStatus = capture?.status;

    // Optimistic update: immediately show "ended" status
    setCapture((prev) =>
      prev ? { ...prev, status: "ended" } : prev
    );

    try {
      const res = await fetch(`${API}/api/captures/${id}/end`, { method: "POST" });
      if (res.ok) {
        toast.info("Call ended. Recording being processed...");
        load();
      } else {
        // Revert optimistic update on failure
        const body = await res.json().catch(() => ({ error: "Failed to end call" }));
        toast.error(body.error || "Failed to end call");
        setCapture((prev) =>
          prev ? { ...prev, status: previousStatus ?? prev.status } : prev
        );
      }
    } catch (err) {
      // Revert optimistic update on network error
      toast.error(err instanceof Error ? err.message : "Network error — could not end call");
      setCapture((prev) =>
        prev ? { ...prev, status: previousStatus ?? prev.status } : prev
      );
    } finally {
      setEndingCall(false);
    }
  }

  // --- Loading skeleton ---
  if (loading && !capture) {
    return <DetailSkeleton />;
  }

  // --- Error state ---
  if (loadError && !capture) {
    return <DetailError message={loadError} onRetry={load} />;
  }

  if (!capture) {
    return <DetailSkeleton />;
  }

  const cfg = statusConfig[capture.status] ?? statusConfig.created;
  const formatDuration = (s?: number | null) => {
    if (!s) return "\u2014";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  // Build public R2 URLs for audio playback
  const R2_PUBLIC = "https://pub-c4f497a2d9354081a36aee5f920fa419.r2.dev";
  const toPublicUrl = (r2Url?: string | null) => {
    if (!r2Url) return null;
    // Extract just the filename (everything after the last /)
    const filename = r2Url.split("/").pop();
    if (!filename) return null;
    return `${R2_PUBLIC}/recordings/${filename}`;
  };

  const mixedAudioUrl = toPublicUrl(capture.recordingUrl);
  const callerAAudioUrl = toPublicUrl(capture.recordingUrlA);
  const callerBAudioUrl = toPublicUrl(capture.recordingUrlB);

  // Determine if action buttons should be in progress (either from user action or optimistic state)
  const isCallActionInProgress = startingCall || endingCall;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push("/capture")}>Back</Button>
          <Separator orientation="vertical" className="h-6" />
          <div>
            <h1 className="text-sm font-semibold">{capture.name}</h1>
            <p className="text-xs text-muted-foreground font-mono">
              {capture.phoneA} &#x2194; {capture.phoneB}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={cfg.color}>
            <span className={`w-2 h-2 rounded-full mr-1.5 ${cfg.dot}`} />
            {cfg.label}
          </Badge>
          {capture.status === "created" && (
            <Button
              size="sm"
              onClick={startCall}
              disabled={startingCall}
            >
              {startingCall ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Starting...
                </>
              ) : (
                "Start Call"
              )}
            </Button>
          )}
          {(capture.status === "calling" || capture.status === "active") && (
            <Button
              size="sm"
              variant="destructive"
              onClick={endCall}
              disabled={endingCall || isCallActionInProgress}
            >
              {endingCall ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Ending...
                </>
              ) : (
                "End Call"
              )}
            </Button>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-lg space-y-6">
          {/* Status card */}
          <Card>
            <CardContent className="py-6 space-y-4">
              <div className="text-center">
                {capture.status === "created" && (
                  <p className="text-muted-foreground">Click &quot;Start Call&quot; to bridge both phones and begin recording.</p>
                )}
                {capture.status === "calling" && (
                  <div className="space-y-2">
                    <div className="w-8 h-8 mx-auto border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                    <p className="text-yellow-300">Calling both numbers...</p>
                  </div>
                )}
                {capture.status === "active" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-green-300 font-medium">Call in progress</span>
                    </div>
                    <p className="text-sm text-muted-foreground">Both parties are connected. Recording in progress.</p>
                  </div>
                )}
                {capture.status === "ended" && (
                  <div className="space-y-2">
                    <div className="w-8 h-8 mx-auto border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    <p className="text-blue-300">Uploading recording to storage...</p>
                    <p className="text-xs text-muted-foreground">This usually takes 10-30 seconds.</p>
                  </div>
                )}
                {capture.status === "completed" && (
                  <div className="space-y-5">
                    <p className="text-emerald-300 font-medium">Recordings ready</p>

                    {/* Mixed (both callers) */}
                    {mixedAudioUrl && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Mixed (both callers)</p>
                        <audio controls className="w-full" src={mixedAudioUrl} />
                      </div>
                    )}

                    {/* Caller A only */}
                    {callerAAudioUrl && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-blue-400">Phone A &#x2014; {capture.phoneA}</p>
                        <audio controls className="w-full" src={callerAAudioUrl} />
                      </div>
                    )}

                    {/* Caller B only */}
                    {callerBAudioUrl && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-orange-400">Phone B &#x2014; {capture.phoneB}</p>
                        <audio controls className="w-full" src={callerBAudioUrl} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Info card */}
          <Card>
            <CardContent className="py-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Phone A</p>
                  <p className="font-mono">{capture.phoneA}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Phone B</p>
                  <p className="font-mono">{capture.phoneB}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Language</p>
                  <p>{capture.language}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Duration</p>
                  <p className="font-mono">{formatDuration(capture.durationSeconds)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Created</p>
                  <p className="text-xs">{new Date(capture.createdAt).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  <p>{capture.status}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
