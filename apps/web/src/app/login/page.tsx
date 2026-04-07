"use client";

import { LoginForm } from "@/components/login-form";
import { AudioWaveformIcon } from "lucide-react";

export default function LoginPage() {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="/" className="flex items-center gap-2 font-medium">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <AudioWaveformIcon className="size-4" />
            </div>
            Voice Capture
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <LoginForm />
          </div>
        </div>
      </div>
      <div className="relative hidden bg-muted lg:block">
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center space-y-4 px-8">
            <AudioWaveformIcon className="size-16 mx-auto text-muted-foreground/20" />
            <p className="text-lg text-muted-foreground/40 font-medium">
              Per-speaker audio capture for ASR datasets
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
