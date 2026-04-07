"use client";

import { LoginForm } from "@/components/login-form";
import { AudioWaveformIcon } from "lucide-react";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";

const stagger = pageStagger;
const fadeUp = pageFadeUp;

export default function LoginPage() {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <motion.div
        className="flex flex-col gap-4 p-6 md:p-10"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        <motion.div
          variants={fadeUp}
          className="flex justify-center gap-2 md:justify-start"
        >
          <a href="/" className="flex items-center gap-2 font-medium">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <AudioWaveformIcon className="size-4" />
            </div>
            Voice Capture
          </a>
        </motion.div>
        <div className="flex flex-1 items-center justify-center">
          <motion.div variants={fadeUp} className="w-full max-w-xs">
            <LoginForm />
          </motion.div>
        </div>
      </motion.div>

      {/* Right panel — animated waveform */}
      <div className="relative hidden bg-muted lg:block overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-secondary via-muted to-secondary" />
        <div className="absolute inset-0 dot-grid" />
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            className="text-center space-y-8 px-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.3 }}
          >
            {/* Waveform bars */}
            <div className="flex items-center justify-center gap-[3px] h-20 mx-auto">
              {Array.from({ length: 24 }).map((_, i) => (
                <div
                  key={i}
                  className="w-[3px] rounded-full bg-muted-foreground/30"
                  style={{
                    animation: `wave-bar ${1.2 + Math.sin(i * 0.5) * 0.4}s ease-in-out infinite`,
                    animationDelay: `${i * 0.06}s`,
                    height: "100%",
                    transformOrigin: "center",
                  }}
                />
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground tracking-[0.2em] uppercase">
                Voice Capture
              </p>
              <p className="text-sm text-muted-foreground/70 max-w-[260px] mx-auto leading-relaxed">
                Per-speaker audio capture for ASR datasets
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
