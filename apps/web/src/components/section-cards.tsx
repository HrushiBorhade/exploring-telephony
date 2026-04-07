"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PhoneCallIcon, CircleCheckIcon, ClockIcon } from "lucide-react";
import type { Capture } from "@/lib/types";

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function SectionCards({ captures }: { captures: Capture[] }) {
  const total = captures.length;
  const live = captures.filter((c) => c.status === "active" || c.status === "calling").length;
  const completed = captures.filter((c) => c.status === "completed").length;
  const totalDuration = captures.reduce((sum, c) => sum + (c.durationSeconds ?? 0), 0);
  const avgDuration = completed > 0 ? Math.round(totalDuration / completed) : 0;

  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <Card>
        <CardHeader>
          <CardDescription>Total Captures</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">
            {total}
          </CardTitle>
        </CardHeader>
        <CardFooter className="text-sm text-muted-foreground">
          <PhoneCallIcon className="mr-1.5 size-4" />
          All time
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Live Now</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">
            {live}
          </CardTitle>
        </CardHeader>
        <CardFooter className="text-sm">
          {live > 0 ? (
            <Badge variant="outline" className="bg-emerald-950 text-emerald-400 border-emerald-900">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Recording
            </Badge>
          ) : (
            <span className="text-muted-foreground">No active calls</span>
          )}
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Completed</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">
            {completed}
          </CardTitle>
        </CardHeader>
        <CardFooter className="text-sm text-muted-foreground">
          <CircleCheckIcon className="mr-1.5 size-4" />
          With recordings
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Avg Duration</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">
            {completed > 0 ? fmtDuration(avgDuration) : "\u2014"}
          </CardTitle>
        </CardHeader>
        <CardFooter className="text-sm text-muted-foreground">
          <ClockIcon className="mr-1.5 size-4" />
          Per capture
        </CardFooter>
      </Card>
    </div>
  );
}
