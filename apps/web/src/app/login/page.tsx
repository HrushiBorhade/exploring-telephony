"use client";

import { LoginForm } from "@/components/login-form";
import { AudioWaveformIcon } from "lucide-react";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { AuthPanel } from "@/components/auth-panel";

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

      <AuthPanel />
    </div>
  );
}
