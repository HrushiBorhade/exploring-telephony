"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useSessionSocket } from "@/lib/use-session-socket";
import type { Session } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const statusConfig: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  created: {
    label: "Ready",
    color: "bg-zinc-700 text-zinc-300",
    dot: "bg-zinc-400",
  },
  calling: {
    label: "Calling...",
    color: "bg-yellow-900 text-yellow-300",
    dot: "bg-yellow-400 animate-pulse",
  },
  active: {
    label: "Live",
    color: "bg-green-900 text-green-300",
    dot: "bg-green-400 animate-pulse",
  },
  ended: {
    label: "Ended",
    color: "bg-zinc-800 text-zinc-400",
    dot: "bg-zinc-500",
  },
};

export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const {
    status,
    transcript,
    currentStep,
    recordingUrl,
    callEvents,
  } = useSessionSocket(session ? sessionId : null);

  // Load session data
  useEffect(() => {
    fetch(`${API}/api/sessions/${sessionId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setSession(data);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Session not found");
        router.push("/");
      });
  }, [sessionId, router]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  async function startCall() {
    const res = await fetch(`${API}/api/sessions/${sessionId}/start`, {
      method: "POST",
    });
    if (res.ok) {
      toast.success("Call initiated!");
    } else {
      const err = await res.json();
      toast.error(err.error || "Failed to start call");
    }
  }

  async function endCall() {
    const res = await fetch(`${API}/api/sessions/${sessionId}/end`, {
      method: "POST",
    });
    if (res.ok) {
      toast.info("Call ended");
    } else {
      const err = await res.json();
      toast.error(err.error || "Failed to end call");
    }
  }

  async function advanceScript() {
    await fetch(`${API}/api/sessions/${sessionId}/advance-script`, {
      method: "POST",
    });
  }

  if (loading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading session...
      </div>
    );
  }

  const cfg = statusConfig[status] ?? statusConfig.created;
  const script = session.scenario.script;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
            Back
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <div>
            <h1 className="text-sm font-semibold">
              {session.scenario.name}
            </h1>
            <p className="text-xs text-muted-foreground">
              {session.scenario.persona}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge className={cfg.color}>
            <span className={`w-2 h-2 rounded-full mr-1.5 ${cfg.dot}`} />
            {cfg.label}
          </Badge>

          {status === "created" && (
            <Button size="sm" onClick={startCall}>
              Start Call
            </Button>
          )}
          {(status === "calling" || status === "active") && (
            <Button size="sm" variant="destructive" onClick={endCall}>
              End Call
            </Button>
          )}
          {recordingUrl && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(recordingUrl, "_blank")}
            >
              Recording
            </Button>
          )}
        </div>
      </header>

      {/* Main content — two panels */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Live Transcript */}
        <div className="flex-1 flex flex-col border-r">
          <div className="px-4 py-2 border-b">
            <h2 className="text-sm font-medium">Live Transcript</h2>
            <p className="text-xs text-muted-foreground">
              {transcript.filter((t) => t.isFinal).length} final entries
            </p>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3">
              {transcript.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {status === "created"
                    ? "Start the call to see the transcript"
                    : status === "calling"
                    ? "Waiting for call to connect..."
                    : "No transcript entries yet"}
                </p>
              )}
              {transcript.map((entry, i) => (
                <div
                  key={`${entry.timestamp}-${i}`}
                  className={`flex gap-3 ${
                    !entry.isFinal ? "opacity-50" : ""
                  }`}
                >
                  <div
                    className={`w-16 shrink-0 text-xs font-mono font-medium pt-0.5 ${
                      entry.speaker === "tester"
                        ? "text-blue-400"
                        : "text-emerald-400"
                    }`}
                  >
                    {entry.speaker === "tester" ? "HUMAN" : "AGENT"}
                  </div>
                  <div className="text-sm leading-relaxed">
                    {entry.text}
                    {!entry.isFinal && (
                      <span className="text-muted-foreground ml-1">...</span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </ScrollArea>
        </div>

        {/* Right: Script Prompter */}
        <div className="w-96 flex flex-col">
          <div className="px-4 py-2 border-b flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Script Prompter</h2>
              <p className="text-xs text-muted-foreground">
                Step {currentStep + 1} of {script.length}
              </p>
            </div>
            {status === "active" &&
              currentStep < script.length - 1 && (
                <Button size="sm" variant="outline" onClick={advanceScript}>
                  Next Step
                </Button>
              )}
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-2">
              {script.map((step, i) => {
                const isCurrent = i === currentStep;
                const isPast = i < currentStep;
                return (
                  <Card
                    key={step.id}
                    className={`transition-all ${
                      isCurrent
                        ? "border-blue-500 bg-blue-950/30"
                        : isPast
                        ? "opacity-40"
                        : "opacity-60"
                    }`}
                  >
                    <CardContent className="py-3 px-4">
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono shrink-0 ${
                            isCurrent
                              ? "bg-blue-500 text-white"
                              : isPast
                              ? "bg-zinc-700 text-zinc-400"
                              : "bg-zinc-800 text-zinc-500"
                          }`}
                        >
                          {i + 1}
                        </div>
                        <div>
                          {isCurrent && (
                            <p className="text-[10px] uppercase tracking-widest text-blue-400 mb-1">
                              Say this now
                            </p>
                          )}
                          <p
                            className={`text-sm ${
                              isCurrent ? "text-foreground font-medium" : ""
                            }`}
                          >
                            {step.prompt}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>

          {/* Call events log */}
          <div className="border-t p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Call Events
            </p>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {callEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No events yet</p>
              ) : (
                callEvents.slice(-5).map((e, i) => (
                  <p key={i} className="text-xs font-mono text-muted-foreground">
                    <span className="text-zinc-500">
                      {new Date(e.time).toLocaleTimeString()}
                    </span>{" "}
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
