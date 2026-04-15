"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Search, Phone, Target } from "lucide-react";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAdminCaptures } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { statusConfig, formatDuration, timeAgo, getDisplayStatus, navigateToCapture } from "@/lib/capture-utils";

function TableSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5 border-b border-border/50">
          <Skeleton className="size-8 rounded-lg" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-4" />
        </div>
      ))}
    </div>
  );
}

// navigateToCapture, getDisplayStatus imported from @/lib/capture-utils

export default function AdminCapturesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  // Read initial type filter from URL (for "Themed Captures" card on admin dashboard)
  const initialType = searchParams.get("type") === "themed" ? "themed" : "all";

  const [typeFilter, setTypeFilter] = useState<string>(initialType);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data, isPending } = useAdminCaptures();

  useEffect(() => {
    if (session && (session.user as any)?.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [session, router]);

  const allCaptures = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  const filtered = useMemo(() => {
    let list = allCaptures;

    // Type filter
    if (typeFilter === "themed") {
      list = list.filter((c) => !!c.themeSampleId);
    } else if (typeFilter === "general") {
      list = list.filter((c) => !c.themeSampleId);
    }

    // Status filter (with verified/pending_review derivation)
    if (statusFilter !== "all") {
      list = list.filter((c) => {
        const ds = getDisplayStatus(c);
        return ds === statusFilter;
      });
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.phoneA?.includes(q) ||
        c.phoneB?.includes(q) ||
        c.id?.includes(q)
      );
    }

    return list;
  }, [allCaptures, typeFilter, statusFilter, search]);

  const hasActiveFilters = typeFilter !== "all" || statusFilter !== "all" || search !== "";

  return (
    <motion.div
      className="p-4 lg:p-6 space-y-4"
      initial="hidden"
      animate="visible"
      variants={pageStagger}
    >
      <motion.div variants={pageFadeUp}>
        <h1 className="text-xl font-semibold font-heading tracking-tight">All Captures</h1>
        <p className="text-sm text-muted-foreground">
          {hasActiveFilters
            ? `${filtered.length} of ${allCaptures.length} captures`
            : `${allCaptures.length} total captures`}
        </p>
      </motion.div>

      {/* Filters */}
      <motion.div variants={pageFadeUp} className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative flex-1 max-w-sm min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by phone or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-xs"
          />
        </div>

        <Select value={typeFilter} onValueChange={(v) => v && setTypeFilter(v)}>
          <SelectTrigger className="w-[120px] sm:w-[140px] h-8 text-xs">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="general">
              <span className="flex items-center gap-1.5"><Phone className="size-3" /> General</span>
            </SelectItem>
            <SelectItem value="themed">
              <span className="flex items-center gap-1.5"><Target className="size-3" /> Themed</span>
            </SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="w-[140px] sm:w-[160px] h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="pending_review">Pending Review</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="active">Recording</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="created">Created</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => { setTypeFilter("all"); setStatusFilter("all"); setSearch(""); }}
          >
            Clear
          </Button>
        )}
      </motion.div>

      {/* Table */}
      <motion.div variants={pageFadeUp} className="border rounded-lg overflow-hidden overflow-x-auto">
        {isPending ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {hasActiveFilters ? "No captures match your filters" : "No captures yet"}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3 sm:pl-4">Capture</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="pr-3 sm:pr-4 w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((capture, i) => {
                const isThemed = !!capture.themeSampleId;
                const ds = getDisplayStatus(capture);
                const cfg = statusConfig[ds] ?? statusConfig.created;
                const dur = ds === "failed" ? null : formatDuration(capture.durationSeconds);

                return (
                  <TableRow
                    key={capture.id}
                    className="cursor-pointer group/row hover:bg-muted/40 transition-colors"
                    onClick={() => navigateToCapture(capture, router.push)}
                    style={{ animation: `fade-in-up 0.3s ease-out backwards`, animationDelay: `${Math.min(i, 15) * 20}ms` }}
                  >
                    {/* Capture: icon + type + phones */}
                    <TableCell className="pl-3 sm:pl-4">
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 flex items-center justify-center size-8 rounded-lg shrink-0 ${
                          isThemed ? "bg-emerald-500/10 text-emerald-500" : "bg-blue-500/10 text-blue-500"
                        }`}>
                          {isThemed ? <Target className="size-4" /> : <Phone className="size-4" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {isThemed ? "Themed" : "General"}
                            </span>
                            {isThemed && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Theme</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                            {capture.phoneA} <span className="text-muted-foreground/40">&rarr;</span> {capture.phoneB}
                          </p>
                        </div>
                      </div>
                    </TableCell>

                    {/* User (last 4 of phone) */}
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      ...{capture.phoneA?.slice(-4) ?? "?"}
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <Badge variant="outline" className={`border-transparent ${cfg.className}`}>
                        <span className={`mr-1.5 inline-block size-1.5 rounded-full ${cfg.dot}${cfg.pulse ? " animate-pulse" : ""}`} />
                        {cfg.label}
                      </Badge>
                    </TableCell>

                    {/* Duration */}
                    <TableCell className="font-mono text-sm tabular-nums">
                      {dur ?? <span className="text-muted-foreground/40">&mdash;</span>}
                    </TableCell>

                    {/* Created */}
                    <TableCell className="text-sm text-muted-foreground" suppressHydrationWarning>
                      {timeAgo(capture.createdAt)}
                    </TableCell>

                    {/* Chevron */}
                    <TableCell className="pr-3 sm:pr-4">
                      <ChevronRight className="size-4 text-muted-foreground/40 ml-auto group-hover/row:text-muted-foreground group-hover/row:translate-x-0.5 transition-all" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </motion.div>
    </motion.div>
  );
}
