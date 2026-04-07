"use client";

import { useEffect, useMemo } from "react";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import {
  AudioPlayerProvider,
  AudioPlayerButton,
  AudioPlayerProgress,
  AudioPlayerDuration,
  AudioPlayerTime,
  useAudioPlayer,
} from "@/components/ui/audio-player";
import { Button } from "@/components/ui/button";

interface WaveformPlayerProps {
  url: string;
  label: string;
  accentColor?: string;
  onDurationLoaded?: (seconds: number) => void;
}

/**
 * Calls setActiveItem on mount so the audio element loads metadata immediately
 * (enables the play button + reports duration without needing a first click).
 * Also fires onDurationLoaded when the browser reads the audio headers.
 */
function TrackInitializer({
  url,
  onDurationLoaded,
}: {
  url: string;
  onDurationLoaded?: (s: number) => void;
}) {
  const { setActiveItem, duration } = useAudioPlayer();

  // Load the audio src on mount so duration is available before first play
  useEffect(() => {
    setActiveItem({ id: url, src: url });
  }, [url, setActiveItem]);

  // Report actual file duration once the browser knows it
  useEffect(() => {
    if (
      duration != null &&
      Number.isFinite(duration) &&
      !Number.isNaN(duration) &&
      onDurationLoaded
    ) {
      onDurationLoaded(duration);
    }
  }, [duration, onDurationLoaded]);

  return null;
}

export function WaveformPlayer({
  url,
  label,
  accentColor = "#71717a",
  onDurationLoaded,
}: WaveformPlayerProps) {
  const item = useMemo(() => ({ id: url, src: url }), [url]);

  function copyUrl() {
    navigator.clipboard.writeText(url).then(() => toast.success("URL copied"));
  }

  function downloadAudio() {
    const a = document.createElement("a");
    a.href = url;
    a.download = url.split("/").pop() || "recording.mp4";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <AudioPlayerProvider>
      <TrackInitializer url={url} onDurationLoaded={onDurationLoaded} />
      <div className={label ? "space-y-1.5" : ""}>
        {label && (
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium truncate" style={{ color: accentColor }}>
              {label}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyUrl} aria-label="Copy URL">
                <Copy className="h-3 w-3 text-muted-foreground" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={downloadAudio} aria-label="Download audio">
                <Download className="h-3 w-3 text-muted-foreground" />
              </Button>
            </div>
          </div>
        )}
        <div
          className={`flex items-center gap-2 sm:gap-3 rounded-lg border border-border/60 bg-muted/60 px-2 sm:px-3 transition-shadow duration-300 hover:shadow-[0_0_12px_-4px_var(--accent-glow)] ${label ? "py-2.5" : "py-1.5"}`}
          style={{ "--accent-glow": accentColor } as React.CSSProperties}
        >
          <AudioPlayerButton
            item={item}
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
          />
          <AudioPlayerProgress className="flex-1" rangeColor={accentColor} />
          <div className="text-xs font-mono text-muted-foreground tabular-nums shrink-0 w-[4.5rem] text-right">
            <AudioPlayerTime className="text-xs font-mono" />
            {" / "}
            <AudioPlayerDuration className="text-xs font-mono" />
          </div>
        </div>
      </div>
    </AudioPlayerProvider>
  );
}
