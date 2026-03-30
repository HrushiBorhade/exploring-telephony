"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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

export default function CaptureDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [capture, setCapture] = useState<Capture | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`${API}/api/captures/${id}`);
    if (res.ok) {
      setCapture(await res.json());
      setLoading(false);
    } else {
      toast.error("Capture not found");
      router.push("/capture");
    }
  }, [id, router]);

  // Poll for status updates
  useEffect(() => {
    load();
    const i = setInterval(load, 3000);
    return () => clearInterval(i);
  }, [load]);

  async function startCall() {
    const res = await fetch(`${API}/api/captures/${id}/start`, { method: "POST" });
    if (res.ok) { toast.success("Calling both phones..."); load(); }
    else toast.error((await res.json()).error || "Failed to start");
  }

  async function endCall() {
    const res = await fetch(`${API}/api/captures/${id}/end`, { method: "POST" });
    if (res.ok) { toast.info("Call ended. Recording being processed..."); load(); }
    else toast.error((await res.json()).error || "Failed to end");
  }

  if (loading || !capture) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  }

  const cfg = statusConfig[capture.status] ?? statusConfig.created;
  const formatDuration = (s?: number | null) => {
    if (!s) return "—";
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
              {capture.phoneA} ↔ {capture.phoneB}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={cfg.color}>
            <span className={`w-2 h-2 rounded-full mr-1.5 ${cfg.dot}`} />
            {cfg.label}
          </Badge>
          {capture.status === "created" && <Button size="sm" onClick={startCall}>Start Call</Button>}
          {(capture.status === "calling" || capture.status === "active") && (
            <Button size="sm" variant="destructive" onClick={endCall}>End Call</Button>
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
                  <p className="text-muted-foreground">Click "Start Call" to bridge both phones and begin recording.</p>
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
                        <p className="text-xs font-medium text-blue-400">Phone A — {capture.phoneA}</p>
                        <audio controls className="w-full" src={callerAAudioUrl} />
                      </div>
                    )}

                    {/* Caller B only */}
                    {callerBAudioUrl && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-orange-400">Phone B — {capture.phoneB}</p>
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
