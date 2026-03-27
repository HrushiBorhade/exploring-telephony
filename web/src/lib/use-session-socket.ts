"use client";

import { useEffect, useRef, useState } from "react";
import type { WsMessage } from "./types";

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";

// Generic transcript entry — works for both test sessions and captures
export interface AnyTranscriptEntry {
  speaker: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export function useSessionSocket(sessionId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<string>("created");
  const [transcript, setTranscript] = useState<AnyTranscriptEntry[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [callEvents, setCallEvents] = useState<
    { event: string; speaker: string; time: number }[]
  >([]);

  useEffect(() => {
    if (!sessionId) return;

    const ws = new WebSocket(`${WS_BASE}/ws/session/${sessionId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data);

      switch (msg.type) {
        case "transcript": {
          const entry = msg.entry as AnyTranscriptEntry;
          setTranscript((prev) => {
            const filtered = prev.filter(
              (e) => e.isFinal || e.speaker !== entry.speaker
            );
            return [...filtered, entry];
          });
          break;
        }

        case "status":
          setStatus(msg.status);
          break;

        case "script_advance":
          setCurrentStep(msg.step);
          break;

        case "recording":
          setRecordingUrl(msg.url);
          break;

        case "call_event":
          setCallEvents((prev) => [
            ...prev,
            { event: msg.event, speaker: msg.speaker, time: Date.now() },
          ]);
          break;
      }
    };

    ws.onerror = () => {
      console.error("WebSocket error");
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  return { status, transcript, currentStep, recordingUrl, callEvents };
}
