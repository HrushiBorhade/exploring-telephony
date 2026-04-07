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
import { PhoneCallIcon, ClockIcon } from "lucide-react";
import { motion } from "motion/react";
import { Skeleton } from "@/components/ui/skeleton";
import { NumberTicker } from "@/components/ui/number-ticker";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { useCaptureStats } from "@/lib/api";

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

function fmtHoursFromSeconds(n: number) {
  const totalSeconds = Math.round(n);
  const h = totalSeconds / 3600;
  if (h >= 1) return `${h.toFixed(1)}h`;
  const m = Math.floor(totalSeconds / 60);
  return `${m}m`;
}

const stagger = pageStagger;
const cardVariant = pageFadeUp;

function CardSkeleton() {
  return (
    <Card className="bg-gradient-to-t from-primary/5 to-card shadow-xs dark:bg-card">
      <CardHeader>
        <Skeleton className="h-4 w-24 skeleton-shimmer" />
        <Skeleton className="h-9 w-16 skeleton-shimmer" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-4 w-32 skeleton-shimmer" />
      </CardContent>
    </Card>
  );
}

export function SectionCards() {
  const { data: stats, isLoading, error } = useCaptureStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (error || !stats) {
    return null;
  }

  const avgDuration = stats.completed > 0 ? Math.round(stats.totalDuration / stats.completed) : 0;

  return (
    <motion.div
      className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      <motion.div variants={cardVariant}>
        <Card className="bg-gradient-to-t from-primary/5 to-card shadow-xs dark:bg-card transition-all duration-200 hover:-translate-y-0.5 hover:ring-foreground/20">
          <CardHeader>
            <CardDescription>Total Captures</CardDescription>
            <CardAction>
              <Badge variant="outline" className="text-xs gap-1 text-muted-foreground border-border">
                {stats.thisWeek} this week
              </Badge>
            </CardAction>
            <CardTitle className="text-4xl font-semibold tracking-tight">
              <NumberTicker value={stats.total} />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <PhoneCallIcon className="size-3.5" />
              {stats.completed} completed
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={cardVariant}>
        <Card className="bg-gradient-to-t from-primary/5 to-card shadow-xs dark:bg-card transition-all duration-200 hover:-translate-y-0.5 hover:ring-foreground/20">
          <CardHeader>
            <CardDescription>Hours Recorded</CardDescription>
            <CardTitle className="text-4xl font-semibold tracking-tight">
              {stats.totalDuration > 0 ? (
                <NumberTicker
                  value={stats.totalDuration}
                  format={fmtHoursFromSeconds}
                />
              ) : (
                "\u2014"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <ClockIcon className="size-3.5" />
              Avg. {fmtDuration(avgDuration)} per capture
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
