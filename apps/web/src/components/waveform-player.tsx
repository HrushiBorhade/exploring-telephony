"use client";

import { useEffect, useMemo } from "react";
import {
  AudioPlayerProvider,
  AudioPlayerButton,
  AudioPlayerProgress,
  AudioPlayerDuration,
  AudioPlayerTime,
  useAudioPlayer,
} from "@/components/ui/audio-player";

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
  const player = useAudioPlayer();

  // Load the audio src on mount so duration is available before first play
  useEffect(() => {
    player.setActiveItem({ id: url, src: url });
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Report actual file duration once the browser knows it
  useEffect(() => {
    if (
      player.duration != null &&
      Number.isFinite(player.duration) &&
      !Number.isNaN(player.duration) &&
      onDurationLoaded
    ) {
      onDurationLoaded(player.duration);
    }
  }, [player.duration, onDurationLoaded]);

  return null;
}

export function WaveformPlayer({
  url,
  label,
  accentColor = "#71717a",
  onDurationLoaded,
}: WaveformPlayerProps) {
  const item = useMemo(() => ({ id: url, src: url }), [url]);

  return (
    <AudioPlayerProvider>
      <TrackInitializer url={url} onDurationLoaded={onDurationLoaded} />
      <div className="space-y-1.5">
        <p className="text-xs font-medium" style={{ color: accentColor }}>
          {label}
        </p>
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-zinc-900/60 px-3 py-2.5">
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
