"use client";

import { motion } from "motion/react";
import { Play, SkipBack, SkipForward } from "lucide-react";

function FluidOrb({ size = 100, speed = 8, delay = 0 }: { size?: number; speed?: number; delay?: number }) {
  return (
    <motion.div
      className="relative rounded-full"
      style={{ width: size, height: size }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, delay }}
    >
      <div className="absolute inset-0 rounded-full border border-border/30 shadow-[0_0_30px_-8px_var(--color-primary)]" />
      <div
        className="absolute inset-[3px] rounded-full overflow-hidden"
        style={{
          animation: `orb-rotate ${speed}s linear infinite`,
          animationDelay: `${delay}s`,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: `conic-gradient(from 0deg, var(--color-primary) 0%, oklch(0.3 0.02 280) 25%, var(--color-primary) 50%, oklch(0.6 0.08 165) 75%, var(--color-primary) 100%)`,
            filter: "blur(8px) saturate(1.2)",
          }}
        />
      </div>
      <div className="absolute inset-[3px] rounded-full bg-background/30 backdrop-blur-[2px]" />
      <div className="absolute inset-[20%] rounded-full bg-gradient-to-br from-white/10 to-transparent" />
    </motion.div>
  );
}

function WaveformDisplay() {
  return (
    <div className="flex items-end gap-[1.5px] h-8 px-3">
      {Array.from({ length: 40 }).map((_, i) => {
        const h = 20 + Math.sin(i * 0.5) * 30 + Math.cos(i * 0.8) * 20;
        return (
          <div
            key={i}
            className="w-[2px] rounded-full bg-muted-foreground/30"
            style={{ height: `${Math.max(10, h)}%` }}
          />
        );
      })}
    </div>
  );
}

function MockAudioPlayer() {
  return (
    <motion.div
      className="w-64 rounded-xl border border-border/30 bg-card/80 backdrop-blur-sm p-4 space-y-3 shadow-lg"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.8 }}
    >
      <div>
        <p className="text-xs font-medium truncate">capture-2026-04-07</p>
        <p className="text-[10px] text-muted-foreground">Speaker A · Hindi</p>
      </div>
      <div className="rounded-lg bg-muted/50 py-2">
        <WaveformDisplay />
      </div>
      <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
        <span>0:14</span>
        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-[35%] rounded-full bg-primary/60" />
        </div>
        <span>0:41</span>
      </div>
      <div className="flex items-center justify-center gap-4">
        <SkipBack className="size-3.5 text-muted-foreground" />
        <div className="size-8 rounded-full border border-border/50 flex items-center justify-center">
          <Play className="size-3.5 text-foreground ml-0.5" />
        </div>
        <SkipForward className="size-3.5 text-muted-foreground" />
      </div>
    </motion.div>
  );
}

/** Dashed grid background — same pattern as annote/frontend auth layout */
const dashedGridStyle = {
  backgroundImage:
    "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
  backgroundSize: "20px 20px",
  maskImage:
    "repeating-linear-gradient(to right, black 0px, black 3px, transparent 3px, transparent 8px), repeating-linear-gradient(to bottom, black 0px, black 3px, transparent 3px, transparent 8px)",
  WebkitMaskImage:
    "repeating-linear-gradient(to right, black 0px, black 3px, transparent 3px, transparent 8px), repeating-linear-gradient(to bottom, black 0px, black 3px, transparent 3px, transparent 8px)",
  maskComposite: "intersect" as const,
  WebkitMaskComposite: "source-in",
};

export function AuthPanel() {
  return (
    <div className="relative hidden bg-muted/40 dark:bg-background lg:block overflow-hidden">
      {/* Dashed grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60 dark:opacity-20"
        style={dashedGridStyle}
      />

      {/* Radial fade for depth */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,var(--color-background)_80%)]" />

      {/* Content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          className="flex flex-col items-center gap-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
        >
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-center gap-2">
              <FluidOrb size={100} speed={8} delay={0} />
              <span className="text-[10px] font-mono text-muted-foreground">Speaker A</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <FluidOrb size={100} speed={12} delay={0.5} />
              <span className="text-[10px] font-mono text-muted-foreground">Speaker B</span>
            </div>
          </div>

          <MockAudioPlayer />
        </motion.div>
      </div>
    </div>
  );
}
