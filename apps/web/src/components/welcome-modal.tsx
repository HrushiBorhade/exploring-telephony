"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageCircle, ExternalLink } from "lucide-react";

interface WelcomeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName?: string;
}

export function WelcomeModal({ open, onOpenChange, userName }: WelcomeModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
        {/* Video section */}
        <div className="relative w-full aspect-video bg-black rounded-t-xl overflow-hidden">
          {open && (
            <iframe
              src="https://www.youtube.com/embed/QG8UrDWSGVw?rel=0&modestbranding=1"
              title="Annote ASR — Platform Walkthrough"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
              loading="lazy"
            />
          )}
        </div>

        <div className="p-5 space-y-4">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-heading">
              Welcome to Annote ASR{userName ? `, ${userName}` : ""} 👋
            </DialogTitle>
            <DialogDescription className="text-sm">
              Watch the walkthrough above to get started, and join our WhatsApp community for support and updates.
            </DialogDescription>
          </DialogHeader>

          {/* WhatsApp CTA */}
          <a
            href="https://chat.whatsapp.com/HYGi03Tl8WeExqM1ZBtpUy"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50"
          >
            <div className="flex items-center justify-center size-10 rounded-full bg-emerald-500 text-white shrink-0">
              <MessageCircle className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                Join WhatsApp Community
              </p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Get help, share feedback, and stay updated
              </p>
            </div>
            <ExternalLink className="size-4 text-emerald-500 shrink-0 ml-auto" />
          </a>

          <div className="pt-1">
            <Button className="w-full gap-1.5" onClick={() => onOpenChange(false)}>
              Get Started
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
