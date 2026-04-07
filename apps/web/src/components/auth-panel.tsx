"use client";

import { motion } from "motion/react";
import { Play } from "lucide-react";

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

function MockAudioPlayer() {
  return (
    <motion.div
      className="w-72 space-y-1.5"
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", duration: 0.6, delay: 0.7, bounce: 0 }}
    >
      {/* Label — matches our WaveformPlayer label style */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium" style={{ color: "#3ea88e" }}>
          Contributor A — Hindi
        </p>
      </div>
      {/* Player bar — matches our WaveformPlayer style */}
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/60 px-2 py-2">
        <div className="size-7 rounded-md flex items-center justify-center shrink-0">
          <Play className="size-3 text-foreground ml-0.5" />
        </div>
        {/* Progress bar */}
        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-[35%] rounded-full bg-primary/60" />
        </div>
        <div className="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0">
          0:14 / 0:41
        </div>
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

      {/* Content — staggered entrance */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-8">
          {/* Orbs stagger in from sides */}
          <div className="flex items-center gap-6">
            <motion.div
              className="flex flex-col items-center gap-2"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", duration: 0.7, delay: 0.2, bounce: 0.1 }}
            >
              <FluidOrb size={100} speed={8} delay={0} />
              <span className="text-[10px] font-mono text-muted-foreground">Contributor A</span>
            </motion.div>
            <motion.div
              className="flex flex-col items-center gap-2"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", duration: 0.7, delay: 0.4, bounce: 0.1 }}
            >
              <FluidOrb size={100} speed={12} delay={0.5} />
              <span className="text-[10px] font-mono text-muted-foreground">Contributor B</span>
            </motion.div>
          </div>

          {/* Player card rises up after orbs */}
          <MockAudioPlayer />
        </div>
      </div>
    </div>
  );
}
