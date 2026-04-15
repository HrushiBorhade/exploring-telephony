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
  Clock,
  Filter,
  ListFilter,
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
import { statusConfig, getDisplayStatus, formatDuration, timeAgo, navigateToCapture } from "@/lib/capture-utils";
import type { Capture } from "@/lib/types";

// navigateToCapture imported from @/lib/capture-utils

// ── Skeleton rows ───────────────────────────────────────────────────

function SkeletonRows({ count = 3 }: { count?: number }) {
  const widths = ["w-28", "w-32", "w-24"];
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <TableRow key={`skeleton-${i}`}>
          {/* Capture: icon + title + phone */}
          <TableCell className="pl-3 sm:pl-6">
            <div className="flex items-start gap-3">
              <Skeleton className="size-8 rounded-lg shrink-0" />
              <div className="space-y-1.5">
                <Skeleton className={`h-4 ${widths[i % widths.length]}`} />
                <Skeleton className="h-3 w-36" />
              </div>
            </div>
          </TableCell>
          {/* Status badge */}
          <TableCell>
            <Skeleton className="h-5 w-20 rounded-full" />
          </TableCell>
          {/* Duration */}
          <TableCell>
            <Skeleton className="h-4 w-10" />
          </TableCell>
          {/* When */}
          <TableCell>
            <Skeleton className="h-4 w-14" />
          </TableCell>
          {/* Chevron */}
          <TableCell className="pr-3 sm:pr-6">
            <Skeleton className="h-4 w-4 ml-auto rounded" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function TableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-3 sm:pl-6">Capture</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>When</TableHead>
          <TableHead className="pr-3 sm:pr-6" />
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
  | "created"
  | "pending_review";

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
      filtered = filtered.filter((c) => {
        const ds = getDisplayStatus(c);
        if (statusFilter === "active") {
          return ds === "calling" || ds === "active";
        }
        return ds === statusFilter;
      });
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
            className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4"
          >
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <ListFilter className="size-3.5" />
              <span className="hidden sm:inline">Filter:</span>
            </div>
            <Select
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v as TypeFilter)}
            >
              <SelectTrigger className="w-[120px] sm:w-[140px] h-8 text-xs">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="general">
                  <span className="flex items-center gap-1.5">
                    <Phone className="size-3" /> General
                  </span>
                </SelectItem>
                <SelectItem value="themed">
                  <span className="flex items-center gap-1.5">
                    <Target className="size-3" /> Themed
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <SelectTrigger className="w-[130px] sm:w-[160px] h-8 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending_review">Pending Review</SelectItem>
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
                className="text-muted-foreground h-8 text-xs"
                onClick={() => {
                  setTypeFilter("all");
                  setStatusFilter("all");
                }}
              >
                Clear
              </Button>
            )}
          </motion.div>

          {/* ── Table ── */}
          <motion.div
            variants={pageFadeUp}
            className="rounded-lg border border-border overflow-hidden overflow-x-auto"
          >
            {isPending ? (
              <TableSkeleton />
            ) : isError && allCaptures.length === 0 ? (
              <div className="py-8 sm:py-12 text-center space-y-3 px-3 sm:px-6">
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
            ) : allCaptures.length === 0 ? (
              <div className="py-12 sm:py-20 text-center px-3 sm:px-6">
                <div className="inline-flex items-center justify-center size-12 rounded-xl bg-muted/50 mb-4">
                  <AudioWaveform className="size-5 text-muted-foreground/50" />
                </div>
                <p className="font-medium text-sm">No captures yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-[260px] mx-auto">
                  Go to the home page and start a new capture to see it here.
                </p>
              </div>
            ) : captures.length === 0 && hasActiveFilters ? (
              <div className="py-10 sm:py-16 text-center px-3 sm:px-6">
                <div className="inline-flex items-center justify-center size-12 rounded-xl bg-muted/50 mb-4">
                  <Filter className="size-5 text-muted-foreground/50" />
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-3 sm:pl-6">Capture</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead className="pr-3 sm:pr-6" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {captures.map((c, i) => {
                    const isThemed = !!c.themeSampleId;
                    const displayStatus = getDisplayStatus(c);
                    const sc = statusConfig[displayStatus] ?? statusConfig.created;
                    const dur = displayStatus === "failed" ? null : formatDuration(c.durationSeconds);

                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer group/row transition-colors hover:bg-muted/40"
                        tabIndex={0}
                        role="link"
                        onClick={() => navigateToCapture(c, router.push)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            navigateToCapture(c, router.push);
                        }}
                        style={{
                          animation: "fade-in-up 0.3s ease-out backwards",
                          animationDelay: `${Math.min(i, 10) * 40}ms`,
                        }}
                      >
                        {/* Capture info — type + phones combined */}
                        <TableCell className="pl-3 sm:pl-6">
                          <div className="flex items-start gap-3">
                            <div className={`mt-0.5 flex items-center justify-center size-8 rounded-lg shrink-0 ${
                              isThemed
                                ? "bg-emerald-500/10 text-emerald-500"
                                : "bg-blue-500/10 text-blue-500"
                            }`}>
                              {isThemed ? (
                                <Target className="size-4" />
                              ) : (
                                <Phone className="size-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">
                                  {isThemed ? "Themed Capture" : "General Capture"}
                                </span>
                                {isThemed && (
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                    Theme
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
                                {c.phoneA}{" "}
                                <span className="text-muted-foreground/40">
                                  &rarr;
                                </span>{" "}
                                {c.phoneB}
                              </p>
                            </div>
                          </div>
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
                        <TableCell>
                          {dur ? (
                            <span className="flex items-center gap-1.5 text-sm tabular-nums font-mono">
                              <Clock className="size-3 text-muted-foreground/50" />
                              {dur}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground/40">&mdash;</span>
                          )}
                        </TableCell>

                        {/* Created */}
                        <TableCell
                          className="text-muted-foreground text-sm"
                          suppressHydrationWarning
                        >
                          {timeAgo(c.createdAt)}
                        </TableCell>

                        {/* Chevron */}
                        <TableCell className="pr-3 sm:pr-6">
                          <ChevronRight className="h-4 w-4 text-muted-foreground/40 ml-auto transition-all group-hover/row:text-muted-foreground group-hover/row:translate-x-0.5" />
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {isFetchingNextPage && <SkeletonRows count={2} />}
                </TableBody>
              </Table>
            )}
          </motion.div>

          {/* ── Infinite scroll sentinel + states ── */}
          {allCaptures.length > 0 && (
            <div className="pt-3 pb-1">
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

              {hasNextPage && !isError && (
                <div ref={sentinelRef} className="h-1" />
              )}

              {isFetchingNextPage && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Loading more...
                  </span>
                </div>
              )}

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
