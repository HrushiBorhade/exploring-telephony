"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import {
  ChevronRight,
  LoaderCircle,
  AudioWaveform,
  AlertCircle,
  Phone,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useCaptures } from "@/lib/api";
import type { Capture } from "@/lib/types";

// ── Status badge config ────────────────────────────────────────────

const statusConfig: Record<
  string,
  { label: string; className: string; dot: string; pulse?: boolean }
> = {
  created: {
    label: "Created",
    className: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  calling: {
    label: "Dialling",
    className: "bg-amber-500/10 text-amber-500",
    dot: "bg-amber-500",
    pulse: true,
  },
  active: {
    label: "Recording",
    className: "bg-emerald-500/10 text-emerald-500",
    dot: "bg-emerald-500",
    pulse: true,
  },
  ended: {
    label: "Uploading",
    className: "bg-blue-500/10 text-blue-500",
    dot: "bg-blue-500",
    pulse: true,
  },
  processing: {
    label: "Processing",
    className: "bg-violet-500/10 text-violet-500",
    dot: "bg-violet-500",
    pulse: true,
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-500/10 text-emerald-500",
    dot: "bg-emerald-500",
  },
};

// ── Helpers ─────────────────────────────────────────────────────────

function formatDuration(seconds?: number | null) {
  if (seconds == null) return "\u2014";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function navigateToCapture(c: Capture, router: ReturnType<typeof useRouter>) {
  const base = `/dashboard/tasks/${c.id}`;
  router.push(c.themeSampleId ? `${base}/themed` : base);
}

// ── Skeleton rows ───────────────────────────────────────────────────

const skeletonWidths = [
  { type: "w-16", phones: "w-40", status: "w-20", dur: "w-10", time: "w-14" },
  { type: "w-14", phones: "w-44", status: "w-18", dur: "w-8", time: "w-16" },
  { type: "w-16", phones: "w-36", status: "w-22", dur: "w-10", time: "w-12" },
];

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const w = skeletonWidths[i % skeletonWidths.length];
        return (
          <TableRow key={`skeleton-${i}`}>
            <TableCell className="pl-6">
              <Skeleton className={`h-5 ${w.type} rounded-full`} />
            </TableCell>
            <TableCell>
              <Skeleton className={`h-4 ${w.phones}`} />
            </TableCell>
            <TableCell>
              <Skeleton className={`h-5 ${w.status} rounded-full`} />
            </TableCell>
            <TableCell>
              <Skeleton className={`h-4 ${w.dur}`} />
            </TableCell>
            <TableCell>
              <Skeleton className={`h-4 ${w.time}`} />
            </TableCell>
            <TableCell className="pr-6">
              <Skeleton className="h-4 w-4 ml-auto" />
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}

function TableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">Type</TableHead>
          <TableHead>Phones</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="pr-6" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <SkeletonRows />
      </TableBody>
    </Table>
  );
}

// ── Filter types ────────────────────────────────────────────────────

type TypeFilter = "all" | "general" | "themed";
type StatusFilter =
  | "all"
  | "completed"
  | "active"
  | "processing"
  | "failed"
  | "created";

// ── Page component ──────────────────────────────────────────────────

export default function TasksPage() {
  const router = useRouter();

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const {
    data,
    isPending,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isError,
    refetch,
  } = useCaptures();

  // Flatten paginated data
  const allCaptures = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  // Client-side filtering
  const captures = useMemo(() => {
    let filtered = allCaptures;

    if (typeFilter !== "all") {
      filtered = filtered.filter((c) => {
        const isThemed = !!c.themeSampleId;
        return typeFilter === "themed" ? isThemed : !isThemed;
      });
    }

    if (statusFilter !== "all") {
      if (statusFilter === "active") {
        // "Active" groups calling + active statuses
        filtered = filtered.filter(
          (c) => c.status === "calling" || c.status === "active",
        );
      } else {
        filtered = filtered.filter((c) => c.status === statusFilter);
      }
    }

    return filtered;
  }, [allCaptures, typeFilter, statusFilter]);

  // Intersection observer for infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  const observerCallback = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (
        entries[0]?.isIntersecting &&
        hasNextPage &&
        !isFetchingNextPage &&
        !isError
      ) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, isError, fetchNextPage],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(observerCallback, {
      rootMargin: "200px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [observerCallback]);

  const hasActiveFilters = typeFilter !== "all" || statusFilter !== "all";

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <motion.div
          className="px-4 lg:px-6"
          initial="hidden"
          animate="visible"
          variants={pageStagger}
        >
          {/* ── Header ── */}
          <motion.div
            variants={pageFadeUp}
            className="flex items-center justify-between mb-4"
          >
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                All Tasks
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {allCaptures.length > 0
                  ? `${captures.length}${hasActiveFilters ? ` of ${allCaptures.length}` : ""} capture${captures.length !== 1 ? "s" : ""}`
                  : "Your captures will appear here"}
              </p>
            </div>
          </motion.div>

          {/* ── Filter bar ── */}
          <motion.div
            variants={pageFadeUp}
            className="flex items-center gap-3 mb-4"
          >
            <Select
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v as TypeFilter)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="themed">Themed</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="created">Created</SelectItem>
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  setTypeFilter("all");
                  setStatusFilter("all");
                }}
              >
                Clear filters
              </Button>
            )}
          </motion.div>

          {/* ── Table ── */}
          <motion.div
            variants={pageFadeUp}
            className="rounded-lg border border-border overflow-hidden"
          >
            {/* Initial loading */}
            {isPending ? (
              <TableSkeleton />
            ) : /* Initial error */
            isError && allCaptures.length === 0 ? (
              <div className="py-12 text-center space-y-3 px-6">
                <AlertCircle className="size-8 mx-auto text-muted-foreground/40" />
                <p className="font-medium">Failed to load tasks</p>
                <p className="text-sm text-muted-foreground">
                  {error?.message}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : /* Empty state — no captures at all */
            allCaptures.length === 0 ? (
              <div className="py-20 text-center px-6">
                <div className="inline-flex items-center justify-center size-12 rounded-xl bg-muted/50 mb-4">
                  <AudioWaveform className="size-5 text-muted-foreground/50" />
                </div>
                <p className="font-medium text-sm">No captures yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-[260px] mx-auto">
                  Go to the home page and start a new capture to see it here.
                </p>
              </div>
            ) : /* Filters matched nothing */
            captures.length === 0 && hasActiveFilters ? (
              <div className="py-16 text-center px-6">
                <div className="inline-flex items-center justify-center size-12 rounded-xl bg-muted/50 mb-4">
                  <AudioWaveform className="size-5 text-muted-foreground/50" />
                </div>
                <p className="font-medium text-sm">No matching captures</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Try adjusting your filters.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setTypeFilter("all");
                    setStatusFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              /* Data table */
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Type</TableHead>
                    <TableHead>Phones</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="pr-6" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {captures.map((c, i) => {
                    const isThemed = !!c.themeSampleId;
                    const callFailed =
                      c.status === "ended" && !c.startedAt;
                    const sc = callFailed
                      ? statusConfig.failed
                      : (statusConfig[c.status] ?? statusConfig.created);

                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer group/row transition-colors hover:bg-muted/40"
                        tabIndex={0}
                        role="link"
                        onClick={() => navigateToCapture(c, router)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            navigateToCapture(c, router);
                        }}
                        style={{
                          animation: "fade-in-up 0.3s ease-out backwards",
                          animationDelay: `${Math.min(i, 10) * 40}ms`,
                        }}
                      >
                        {/* Type badge */}
                        <TableCell className="pl-6">
                          {isThemed ? (
                            <Badge
                              variant="secondary"
                              className="gap-1"
                            >
                              <Target className="size-3" />
                              Themed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1">
                              <Phone className="size-3" />
                              General
                            </Badge>
                          )}
                        </TableCell>

                        {/* Phones */}
                        <TableCell className="font-mono text-xs text-muted-foreground max-w-[200px] truncate">
                          {c.phoneA}{" "}
                          <span className="text-muted-foreground/40">
                            &rarr;
                          </span>{" "}
                          {c.phoneB}
                        </TableCell>

                        {/* Status badge */}
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`transition-colors border-transparent ${sc.className}`}
                          >
                            <span
                              className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${sc.dot}${sc.pulse ? " animate-pulse" : ""}`}
                            />
                            {sc.label}
                          </Badge>
                        </TableCell>

                        {/* Duration */}
                        <TableCell className="font-mono text-sm tabular-nums">
                          {formatDuration(c.durationSeconds)}
                        </TableCell>

                        {/* Created */}
                        <TableCell
                          className="text-muted-foreground text-sm"
                          suppressHydrationWarning
                        >
                          {timeAgo(c.createdAt)}
                        </TableCell>

                        {/* Chevron */}
                        <TableCell className="pr-6">
                          <ChevronRight className="h-4 w-4 text-muted-foreground/40 ml-auto transition-all group-hover/row:text-muted-foreground group-hover/row:translate-x-0.5" />
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {/* Loading next page skeleton rows */}
                  {isFetchingNextPage && <SkeletonRows count={2} />}
                </TableBody>
              </Table>
            )}
          </motion.div>

          {/* ── Infinite scroll sentinel + states ── */}
          {allCaptures.length > 0 && (
            <div className="pt-3 pb-1">
              {/* Error loading next page */}
              {isError && allCaptures.length > 0 && !isFetchingNextPage && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <AlertCircle className="size-3.5 text-destructive" />
                  <span className="text-sm text-muted-foreground">
                    Failed to load more
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchNextPage()}
                  >
                    Retry
                  </Button>
                </div>
              )}

              {/* Sentinel for auto-load */}
              {hasNextPage && !isError && (
                <div ref={sentinelRef} className="h-1" />
              )}

              {/* Loading indicator below table */}
              {isFetchingNextPage && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Loading more...
                  </span>
                </div>
              )}

              {/* End of list */}
              {!hasNextPage && !isPending && allCaptures.length > 0 && (
                <p className="text-center text-xs text-muted-foreground/50 py-1">
                  All {allCaptures.length} captures loaded
                </p>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
