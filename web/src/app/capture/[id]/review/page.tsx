"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import type { Capture } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_API_URL || "";

interface Word {
  id: number;
  speaker: string;
  word: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

interface TranscriptRow {
  id: number;
  speaker: string;
  text: string;
  startTime: number | null;
  endTime: number | null;
  timestamp: number;
}

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const captureId = params.id as string;

  const [capture, setCapture] = useState<Capture | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Audio state
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<string>("caller_a");

  // Load capture data + words
  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/captures/${captureId}`).then((r) => r.json()),
      fetch(`${API}/api/captures/${captureId}/words`).then((r) => r.json()),
    ])
      .then(([captureData, wordsData]) => {
        setCapture(captureData);
        setWords(wordsData);
        // Build transcript rows from capture data
        if (captureData.transcript) {
          setTranscripts(
            captureData.transcript
              .filter((t: any) => t.isFinal)
              .map((t: any, i: number) => ({
                id: i,
                speaker: t.speaker,
                text: t.text,
                startTime: t.startTime ?? null,
                endTime: t.endTime ?? null,
                timestamp: t.timestamp,
              }))
          );
        }
        setLoading(false);
      })
      .catch(() => {
        toast.error("Capture not found");
        router.push("/capture");
      });
  }, [captureId, router]);

  // Update currentTime from audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDuration = () => setDuration(audio.duration);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [loading]);

  // Find current active word based on audio time
  const activeWordIndex = words.findIndex(
    (w) => currentTime >= w.startTime && currentTime <= w.endTime
  );

  // Find current active transcript row
  const activeTranscriptIndex = transcripts.findIndex(
    (t) =>
      t.startTime !== null &&
      t.endTime !== null &&
      currentTime >= t.startTime &&
      currentTime <= t.endTime
  );

  const seekTo = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (audioRef.current) {
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play();
    }
  }, [isPlaying]);

  if (loading || !capture) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading review...
      </div>
    );
  }

  const recordingSid = capture.recordingUrl?.match(/Recordings\/([^.]+)/)?.[1];
  const audioSrc = recordingSid
    ? `${API}/api/recordings/${recordingSid}`
    : `${API}/api/audio/${captureId}/${activeSpeaker}`;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/capture/${captureId}`)}
          >
            Back to Session
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <div>
            <h1 className="text-sm font-semibold">{capture.name} — Review</h1>
            <p className="text-xs text-muted-foreground font-mono">
              {words.length} words | {transcripts.length} utterances
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            window.open(`${API}/api/captures/${captureId}/export`, "_blank")
          }
        >
          Export Dataset
        </Button>
      </header>

      {/* Audio player */}
      <div className="border-b px-6 py-4">
        <audio ref={audioRef} src={audioSrc} preload="metadata" />

        <div className="flex items-center gap-4">
          <Button size="sm" variant="outline" onClick={togglePlay}>
            {isPlaying ? "Pause" : "Play"}
          </Button>

          <span className="text-sm font-mono text-muted-foreground w-20">
            {formatTime(currentTime)}
          </span>

          {/* Progress bar */}
          <div
            className="flex-1 h-2 bg-zinc-800 rounded-full cursor-pointer relative"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              seekTo(pct * duration);
            }}
          >
            <div
              className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${(currentTime / duration) * 100}%` }}
            />
            {/* Speaker indicators on timeline */}
            {transcripts.map(
              (t, i) =>
                t.startTime !== null &&
                t.endTime !== null && (
                  <div
                    key={i}
                    className={`absolute top-0 h-full rounded-sm opacity-30 ${
                      t.speaker === "caller_a" ? "bg-blue-400" : "bg-orange-400"
                    }`}
                    style={{
                      left: `${(t.startTime / duration) * 100}%`,
                      width: `${((t.endTime - t.startTime) / duration) * 100}%`,
                    }}
                  />
                )
            )}
          </div>

          <span className="text-sm font-mono text-muted-foreground w-20 text-right">
            {formatTime(duration)}
          </span>

          {/* Speaker selector for per-speaker audio */}
          {!recordingSid && (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={activeSpeaker === "caller_a" ? "default" : "outline"}
                onClick={() => setActiveSpeaker("caller_a")}
              >
                A
              </Button>
              <Button
                size="sm"
                variant={activeSpeaker === "caller_b" ? "default" : "outline"}
                onClick={() => setActiveSpeaker("caller_b")}
              >
                B
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Main content: word cloud + transcript */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Word-level transcript (clickable) */}
        <div className="flex-1 flex flex-col border-r">
          <div className="px-4 py-2 border-b">
            <h2 className="text-sm font-medium">
              Word-Level Transcript
            </h2>
            <p className="text-xs text-muted-foreground">
              Click any word to seek. Active word is highlighted.
            </p>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="flex flex-wrap gap-x-1 gap-y-1.5 leading-relaxed">
              {words.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No word-level data yet. Make a call first.
                </p>
              ) : (
                words.map((w, i) => {
                  const isActive = i === activeWordIndex;
                  const speakerChanged =
                    i === 0 || words[i - 1].speaker !== w.speaker;

                  return (
                    <span key={w.id ?? i}>
                      {speakerChanged && (
                        <>
                          {i > 0 && <br />}
                          <span
                            className={`text-[10px] uppercase tracking-widest mr-2 ${
                              w.speaker === "caller_a"
                                ? "text-blue-400"
                                : "text-orange-400"
                            }`}
                          >
                            {w.speaker === "caller_a" ? "Phone A" : "Phone B"}
                          </span>
                        </>
                      )}
                      <span
                        className={`cursor-pointer px-0.5 rounded text-sm transition-colors ${
                          isActive
                            ? "bg-blue-500 text-white"
                            : "hover:bg-zinc-800"
                        } ${
                          w.confidence < 0.8
                            ? "underline decoration-dotted decoration-yellow-500"
                            : ""
                        }`}
                        title={`${w.startTime.toFixed(2)}s - ${w.endTime.toFixed(2)}s (${(w.confidence * 100).toFixed(0)}%)`}
                        onClick={() => seekTo(w.startTime)}
                      >
                        {w.word}
                      </span>
                    </span>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right: Utterance-level transcript */}
        <div className="w-96 flex flex-col">
          <div className="px-4 py-2 border-b">
            <h2 className="text-sm font-medium">Utterances</h2>
            <p className="text-xs text-muted-foreground">
              Click to seek to utterance
            </p>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-2">
              {transcripts.map((t, i) => (
                <Card
                  key={t.id}
                  className={`cursor-pointer transition-all ${
                    i === activeTranscriptIndex
                      ? "border-blue-500 bg-blue-950/20"
                      : "hover:bg-zinc-900"
                  }`}
                  onClick={() => t.startTime !== null && seekTo(t.startTime)}
                >
                  <CardContent className="py-2 px-3">
                    <div className="flex items-start gap-2">
                      <Badge
                        className={`text-[10px] shrink-0 ${
                          t.speaker === "caller_a"
                            ? "bg-blue-900 text-blue-300"
                            : "bg-orange-900 text-orange-300"
                        }`}
                      >
                        {t.speaker === "caller_a" ? "A" : "B"}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-sm leading-relaxed">{t.text}</p>
                        {t.startTime !== null && (
                          <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                            {formatTime(t.startTime)} -{" "}
                            {t.endTime !== null && formatTime(t.endTime)}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>

          {/* Stats */}
          <div className="border-t p-4">
            <h3 className="text-sm font-medium mb-2">Stats</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total words</span>
                <span className="font-mono">{words.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg confidence</span>
                <span className="font-mono">
                  {words.length > 0
                    ? (
                        (words.reduce((a, w) => a + w.confidence, 0) /
                          words.length) *
                        100
                      ).toFixed(1)
                    : 0}
                  %
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Low confidence</span>
                <span className="font-mono text-yellow-400">
                  {words.filter((w) => w.confidence < 0.8).length} words
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
