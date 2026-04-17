"use client";

import { Play } from "lucide-react";
import { SidebarGroup } from "@/components/ui/sidebar";

interface SidebarWelcomeBannerProps {
  onClick: () => void;
}

export function SidebarWelcomeBanner({ onClick }: SidebarWelcomeBannerProps) {
  return (
    <SidebarGroup>
      <button
        onClick={onClick}
        className="flex items-center gap-2.5 w-full rounded-lg bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20 px-3 py-2 text-left transition-all hover:from-emerald-500/15 hover:to-cyan-500/15 hover:border-emerald-500/30 active:scale-[0.98]"
      >
        <div className="flex items-center justify-center size-7 rounded-full bg-emerald-500/15 shrink-0">
          <Play className="size-3.5 text-emerald-600 dark:text-emerald-400 ml-0.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium truncate">Getting Started</p>
          <p className="text-[10px] text-muted-foreground truncate">Watch walkthrough</p>
        </div>
      </button>
    </SidebarGroup>
  );
}
