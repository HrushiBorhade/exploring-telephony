"use client";

import { motion } from "motion/react";
import { Play, PhoneCall } from "lucide-react";

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

function MiniPlayer({ label, color, progress, time, delay }: {
  label: string;
  color: string;
  progress: number;
  time: string;
  delay: number;
}) {
  return (
    <motion.div
      className="w-full space-y-1"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.5, delay, bounce: 0 }}
    >
      <p className="text-[10px] font-medium truncate" style={{ color }}>
        {label}
      </p>
      <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/40 px-1.5 py-1.5">
        <Play className="size-2.5 text-foreground ml-0.5 shrink-0" />
        <div className="flex-1 h-[3px] rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-primary/50" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-[9px] font-mono text-muted-foreground tabular-nums shrink-0">{time}</span>
      </div>
    </motion.div>
  );
}

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
      <div
        className="pointer-events-none absolute inset-0 opacity-60 dark:opacity-20"
        style={dashedGridStyle}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,var(--color-background)_80%)]" />

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          {/* Two orbs with telephony connection line */}
          <div className="flex items-center gap-0">
            <motion.div
              className="flex flex-col items-center gap-2"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", duration: 0.7, delay: 0.2, bounce: 0.1 }}
            >
              <FluidOrb size={90} speed={8} delay={0} />
              <span className="text-[10px] font-mono text-muted-foreground">Contributor A</span>
            </motion.div>

            {/* Connection line with phone icon */}
            <motion.div
              className="flex flex-col items-center gap-1 mx-2"
              initial={{ opacity: 0, scaleX: 0 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ type: "spring", duration: 0.5, delay: 0.5, bounce: 0 }}
            >
              <div className="flex items-center gap-1">
                <div className="w-6 h-px bg-border" />
                <div className="size-6 rounded-full border border-border/50 bg-card/80 flex items-center justify-center">
                  <PhoneCall className="size-2.5 text-primary" />
                </div>
                <div className="w-6 h-px bg-border" />
              </div>
            </motion.div>

            <motion.div
              className="flex flex-col items-center gap-2"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", duration: 0.7, delay: 0.4, bounce: 0.1 }}
            >
              <FluidOrb size={90} speed={12} delay={0.5} />
              <span className="text-[10px] font-mono text-muted-foreground">Contributor B</span>
            </motion.div>
          </div>

          {/* 3 audio player cards — mixed + per-speaker */}
          <motion.div
            className="w-64 space-y-2"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", duration: 0.6, delay: 0.7, bounce: 0 }}
          >
            <MiniPlayer label="Mixed — both contributors" color="#a1a1aa" progress={35} time="0:14 / 0:41" delay={0.8} />
            <div className="grid grid-cols-2 gap-2">
              <MiniPlayer label="Contributor A" color="#3ea88e" progress={52} time="0:22 / 0:41" delay={0.9} />
              <MiniPlayer label="Contributor B" color="#8b8b96" progress={18} time="0:07 / 0:41" delay={1.0} />
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
