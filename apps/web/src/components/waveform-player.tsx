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

function TrackInitializer({
  url,
  onDurationLoaded,
}: {
  url: string;
  onDurationLoaded?: (s: number) => void;
}) {
  const { setActiveItem, duration } = useAudioPlayer();

  useEffect(() => {
    setActiveItem({ id: url, src: url });
  }, [url, setActiveItem]);

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

  async function downloadAudio() {
    try {
      toast.info("Downloading...");
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = url.split("/").pop()?.split("?")[0] || "recording.mp4";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("Download failed — try right-clicking the player instead");
    }
  }

  const hasLabel = label.length > 0;

  return (
    <AudioPlayerProvider>
      <TrackInitializer url={url} onDurationLoaded={onDurationLoaded} />
      <div className={hasLabel ? "space-y-1" : ""}>
        {hasLabel && (
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium truncate" style={{ color: accentColor }}>
              {label}
            </p>
            <div className="flex items-center gap-0.5 shrink-0">
              <Button variant="ghost" size="icon-xs" onClick={copyUrl} aria-label="Copy URL">
                <Copy className="size-2.5 text-muted-foreground" />
              </Button>
              <Button variant="ghost" size="icon-xs" onClick={downloadAudio} aria-label="Download audio">
                <Download className="size-2.5 text-muted-foreground" />
              </Button>
            </div>
          </div>
        )}
        <div
          className={`flex items-center gap-2 rounded-lg border border-border/60 bg-muted/60 px-2 transition-shadow duration-300 hover:shadow-[0_0_12px_-4px_var(--accent-glow)] ${hasLabel ? "py-2" : "py-1.5"}`}
          style={{ "--accent-glow": accentColor } as React.CSSProperties}
        >
          <AudioPlayerButton
            item={item}
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
          />
          <AudioPlayerProgress className="flex-1" rangeColor={accentColor} />
          <div className="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0 text-right">
            <AudioPlayerTime className="text-[11px] font-mono" />
            {" / "}
            <AudioPlayerDuration className="text-[11px] font-mono" />
          </div>
        </div>
      </div>
    </AudioPlayerProvider>
  );
}
