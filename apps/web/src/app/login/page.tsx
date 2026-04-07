"use client";

import { LoginForm } from "@/components/login-form";
import { AudioWaveformIcon } from "lucide-react";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import { Ripple } from "@/components/ui/ripple";

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
            Annote ASR
          </a>
        </motion.div>
        <div className="flex flex-1 items-center justify-center">
          <motion.div variants={fadeUp} className="w-full max-w-xs">
            <LoginForm />
          </motion.div>
        </div>
      </motion.div>

      {/* Right panel — flickering grid + ripple + audio orb */}
      <div className="relative hidden bg-background lg:block overflow-hidden">
        {/* Flickering grid background */}
        <div className="absolute inset-0">
          <FlickeringGrid
            squareSize={4}
            gridGap={6}
            flickerChance={0.3}
            color="var(--color-primary)"
            maxOpacity={0.15}
          />
        </div>

        {/* Ripple rings emanating from center */}
        <Ripple
          mainCircleSize={160}
          mainCircleOpacity={0.08}
          numCircles={3}
        />

        {/* Radial fade at edges */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_20%,var(--color-background)_65%)]" />

        {/* Audio orb at center */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          >
            <div className="relative size-28">
              {/* Glass orb */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/15 backdrop-blur-sm flex items-center justify-center shadow-[0_0_40px_-8px_var(--color-primary)]">
                {/* Waveform bars */}
                <div className="flex items-center gap-[2px] h-10">
                  {Array.from({ length: 14 }).map((_, i) => (
                    <div
                      key={i}
                      className="w-[2px] rounded-full bg-primary/70"
                      style={{
                        animation: `wave-bar ${1.0 + Math.sin(i * 0.6) * 0.5}s ease-in-out infinite`,
                        animationDelay: `${i * 0.08}s`,
                        height: "100%",
                        transformOrigin: "center",
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
