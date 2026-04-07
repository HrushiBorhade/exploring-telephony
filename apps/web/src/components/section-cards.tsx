"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUpIcon, TrendingDownIcon, PhoneCallIcon, ClockIcon, CircleCheckIcon, Loader2Icon } from "lucide-react";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import type { Capture } from "@/lib/types";

function fmtHours(totalSeconds: number) {
  const h = totalSeconds / 3600;
  if (h >= 1) return `${h.toFixed(1)}h`;
  const m = Math.floor(totalSeconds / 60);
  return `${m}m`;
}

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const stagger = pageStagger;
const cardVariant = pageFadeUp;

function TrendBadge({ value, label }: { value: number; label?: string }) {
  if (value === 0 && !label) return null;
  if (label) {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-muted-foreground border-border">
        {label}
      </Badge>
    );
  }
  const isUp = value > 0;
  return (
    <Badge variant="outline" className={`text-xs gap-1 ${isUp ? "text-emerald-700 border-emerald-300 dark:text-emerald-400 dark:border-emerald-800" : "text-red-700 border-red-300 dark:text-red-400 dark:border-red-800"}`}>
      {isUp ? <TrendingUpIcon className="size-3" /> : <TrendingDownIcon className="size-3" />}
      {isUp ? "+" : ""}{value}%
    </Badge>
  );
}

export function SectionCards({ captures }: { captures: Capture[] }) {
  const total = captures.length;
  const completed = captures.filter((c) => c.status === "completed").length;
  const totalDuration = captures.reduce((sum, c) => sum + (c.durationSeconds ?? 0), 0);
  const avgDuration = completed > 0 ? Math.round(totalDuration / completed) : 0;
  const languages = new Set(captures.map((c) => c.language).filter(Boolean));
  const pending = captures.filter((c) => c.status !== "completed" && c.status !== "ended").length;
  const successRate = total > 0 ? ((completed / total) * 100).toFixed(1) : "0";

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const thisWeek = captures.filter((c) => now - new Date(c.createdAt).getTime() < weekMs).length;
  const lastWeek = captures.filter((c) => {
    const age = now - new Date(c.createdAt).getTime();
    return age >= weekMs && age < weekMs * 2;
  }).length;
  const weekTrend = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;

  return (
    <motion.div
      className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      <motion.div variants={cardVariant}>
        <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:ring-foreground/20">
          <CardHeader>
            <CardDescription>Total Captures</CardDescription>
            <CardAction>
              <TrendBadge value={weekTrend} label={weekTrend === 0 ? `${thisWeek} this week` : undefined} />
            </CardAction>
            <CardTitle className="text-4xl font-semibold tabular-nums tracking-tight">
              {total}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <PhoneCallIcon className="size-3.5" />
              {thisWeek} new this week
            </div>
            <div className="mt-1 text-xs text-muted-foreground/60">
              Across {languages.size || 1} language{languages.size !== 1 ? "s" : ""}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={cardVariant}>
        <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:ring-foreground/20">
          <CardHeader>
            <CardDescription>Hours Recorded</CardDescription>
            <CardTitle className="text-4xl font-semibold tabular-nums tracking-tight">
              {totalDuration > 0 ? fmtHours(totalDuration) : "\u2014"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <ClockIcon className="size-3.5" />
              Avg. {fmtDuration(avgDuration)} per capture
            </div>
            <div className="mt-1 text-xs text-muted-foreground/60">
              {completed} completed capture{completed !== 1 ? "s" : ""}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={cardVariant}>
        <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:ring-foreground/20">
          <CardHeader>
            <CardDescription>Success Rate</CardDescription>
            <CardTitle className="text-4xl font-semibold tabular-nums tracking-tight">
              {successRate}%
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <CircleCheckIcon className="size-3.5" />
              {completed} of {total} completed
            </div>
            <div className="mt-1 text-xs text-muted-foreground/60">
              Target: 90% approval
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={cardVariant}>
        <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:ring-foreground/20">
          <CardHeader>
            <CardDescription>Pending</CardDescription>
            <CardTitle className="text-4xl font-semibold tabular-nums tracking-tight">
              {pending}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <Loader2Icon className="size-3.5" />
              {captures.filter((c) => c.status === "processing").length} processing now
            </div>
            <div className="mt-1 text-xs text-muted-foreground/60">
              Avg. {fmtDuration(avgDuration)} per capture
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
