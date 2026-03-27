"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useSessionSocket } from "@/lib/use-session-socket";
import type { Capture } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
  created: { label: "Ready", color: "bg-zinc-700 text-zinc-300", dot: "bg-zinc-400" },
  calling: { label: "Calling...", color: "bg-yellow-900 text-yellow-300", dot: "bg-yellow-400 animate-pulse" },
  active: { label: "Recording", color: "bg-red-900 text-red-300", dot: "bg-red-400 animate-pulse" },
  ended: { label: "Ended", color: "bg-zinc-800 text-zinc-400", dot: "bg-zinc-500" },
};

export default function CaptureDetailPage() {
  const params = useParams();
  const router = useRouter();
  const captureId = params.id as string;

  const [capture, setCapture] = useState<Capture | null>(null);
  const [loading, setLoading] = useState(true);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const { status, transcript, recordingUrl: wsRecordingUrl, callEvents } = useSessionSocket(
    capture ? captureId : null
  );

  // Use recording URL from WebSocket (live) or initial fetch (page reload)
  const recordingUrl = wsRecordingUrl || capture?.recordingUrl || null;

  useEffect(() => {
    fetch(`${API}/api/captures/${captureId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { setCapture(data); setLoading(false); })
      .catch(() => { toast.error("Capture not found"); router.push("/capture"); });
  }, [captureId, router]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  async function startCall() {
    const res = await fetch(`${API}/api/captures/${captureId}/start`, { method: "POST" });
    if (res.ok) toast.success("Calling both numbers...");
    else toast.error((await res.json()).error || "Failed");
  }

  async function endCall() {
    const res = await fetch(`${API}/api/captures/${captureId}/end`, { method: "POST" });
    if (res.ok) toast.info("Call ended");
    else toast.error((await res.json()).error || "Failed");
  }

  function exportDataset() {
    window.open(`${API}/api/captures/${captureId}/export`, "_blank");
  }

  if (loading || !capture) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  }

  const cfg = statusConfig[status] ?? statusConfig.created;
  const finalCount = transcript.filter((t) => t.isFinal).length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push("/capture")}>
            Back
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <div>
            <h1 className="text-sm font-semibold">{capture.name}</h1>
            <p className="text-xs text-muted-foreground font-mono">
              {capture.phoneA} ↔ {capture.phoneB} ({capture.language})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge className={cfg.color}>
            <span className={`w-2 h-2 rounded-full mr-1.5 ${cfg.dot}`} />
            {cfg.label}
          </Badge>

          {status === "created" && <Button size="sm" onClick={startCall}>Start Call</Button>}
          {(status === "calling" || status === "active") && (
            <Button size="sm" variant="destructive" onClick={endCall}>End Call</Button>
          )}
          {status === "ended" && (
            <>
              <Button size="sm" onClick={() => router.push(`/capture/${captureId}/review`)}>
                Review Audio
              </Button>
              <Button size="sm" variant="outline" onClick={exportDataset}>
                Export Dataset
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Transcript + stats */}
      <div className="flex-1 flex overflow-hidden">
        {/* Transcript */}
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-2 border-b flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Live Transcript</h2>
              <p className="text-xs text-muted-foreground">{finalCount} utterances captured</p>
            </div>
            {status === "active" && (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                Recording
              </div>
            )}
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3">
              {transcript.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {status === "created" ? "Start the call to begin recording" : "Waiting for audio..."}
                </p>
              )}
              {transcript.map((entry, i) => (
                <div key={`${entry.timestamp}-${i}`} className={`flex gap-3 ${!entry.isFinal ? "opacity-50" : ""}`}>
                  <div className={`w-20 shrink-0 text-xs font-mono font-medium pt-0.5 ${
                    entry.speaker === "caller_a" ? "text-blue-400" : "text-orange-400"
                  }`}>
                    {entry.speaker === "caller_a" ? "PHONE A" : "PHONE B"}
                  </div>
                  <div className="text-sm leading-relaxed">
                    {entry.text}
                    {!entry.isFinal && <span className="text-muted-foreground ml-1">...</span>}
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </ScrollArea>
        </div>

        {/* Right sidebar — stats + events */}
        <div className="w-72 border-l flex flex-col">
          <div className="p-4 border-b">
            <h3 className="text-sm font-medium mb-3">Capture Info</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone A</span>
                <span className="font-mono text-xs">{capture.phoneA}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone B</span>
                <span className="font-mono text-xs">{capture.phoneB}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Language</span>
                <Badge variant="outline" className="text-xs">{capture.language}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Utterances</span>
                <span className="font-mono">{finalCount}</span>
              </div>
            </div>
          </div>

          {/* Audio player */}
          {recordingUrl && (
            <div className="p-4 border-b">
              <h3 className="text-sm font-medium mb-3">Recording</h3>
              <audio
                controls
                className="w-full h-10"
                src={`${API}/api/recordings/${recordingUrl.match(/Recordings\/([^.]+)/)?.[1] ?? ""}`}
              />
              <p className="text-[10px] text-muted-foreground mt-2 font-mono truncate">
                {recordingUrl.match(/Recordings\/([^.]+)/)?.[1]}
              </p>
            </div>
          )}

          <div className="flex-1 p-4">
            <h3 className="text-sm font-medium mb-2">Call Events</h3>
            <div className="space-y-1 overflow-y-auto">
              {callEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No events yet</p>
              ) : (
                callEvents.slice(-10).map((e, i) => (
                  <p key={i} className="text-xs font-mono text-muted-foreground">
                    <span className="text-zinc-500">{new Date(e.time).toLocaleTimeString()}</span>{" "}
                    {e.speaker}: {e.event}
                  </p>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
