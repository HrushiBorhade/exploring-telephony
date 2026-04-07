"use client";

import { LoginForm } from "@/components/login-form";
import { AudioWaveformIcon } from "lucide-react";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { FlickeringGrid } from "@/components/ui/flickering-grid";

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

      {/* Right panel — flickering grid + audio visualization */}
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

        {/* Radial fade at edges */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,var(--color-background)_70%)]" />

        {/* Content */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            className="text-center px-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
          >
            {/* Audio orb — pulsing circle with waveform bars */}
            <div className="relative mx-auto size-40">
              {/* Outer glow rings */}
              <div className="absolute inset-0 rounded-full bg-primary/5 animate-ping" style={{ animationDuration: "3s" }} />
              <div className="absolute inset-3 rounded-full bg-primary/8 animate-ping" style={{ animationDuration: "2.5s", animationDelay: "0.5s" }} />

              {/* Core orb */}
              <div className="absolute inset-6 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 backdrop-blur-sm flex items-center justify-center">
                {/* Waveform bars inside orb */}
                <div className="flex items-center gap-[2px] h-12">
                  {Array.from({ length: 16 }).map((_, i) => (
                    <div
                      key={i}
                      className="w-[2px] rounded-full bg-primary/60"
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
