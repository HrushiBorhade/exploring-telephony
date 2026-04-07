"use client"

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler"

export function ThemeToggle() {
  return (
    <AnimatedThemeToggler className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" />
  )
}
