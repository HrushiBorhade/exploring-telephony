"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronLeftIcon,
  ChevronRightIcon,
  Target,
  ExternalLink,
  Search,
} from "lucide-react";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useAdminThemeSamples } from "@/lib/api";
import { useSession } from "@/lib/auth-client";

// ── Constants ─────────────────────────────────────────────────────

const PAGE_SIZE = 25;

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  available: { label: "Available", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  assigned:  { label: "Assigned",  className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  completed: { label: "Completed", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
};

const CATEGORY_LABELS: Record<string, string> = {
  alphanumeric: "Alphanumeric",
  healthcare: "Healthcare",
  short_utterances: "Short Utterances",
};

const LANG_LABELS: Record<string, string> = {
  hindi: "Hindi",
  telugu: "Telugu",
};

function formatFieldLabel(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Component ─────────────────────────────────────────────────────

export default function AdminThemesPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: samples, isPending } = useAdminThemeSamples();

  const [langFilter, setLangFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (session && (session.user as any)?.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [session, router]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [langFilter, catFilter, statusFilter, search]);

  // Filter
  const filtered = useMemo(() => {
    if (!samples) return [];
    return samples.filter((s) => {
      if (langFilter !== "all" && s.language !== langFilter) return false;
      if (catFilter !== "all" && s.category !== catFilter) return false;
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        // Search across all values in the data object + capture ID
        const dataStr = Object.values(s.data).join(" ").toLowerCase();
        const idMatch = s.assignedCaptureId?.toLowerCase().includes(q);
        if (!dataStr.includes(q) && !idMatch) return false;
      }
      return true;
    });
  }, [samples, langFilter, catFilter, statusFilter, search]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page],
  );

  // Summary
  const counts = useMemo(() => {
    if (!samples) return { total: 0, available: 0, assigned: 0, completed: 0 };
    return {
      total: samples.length,
      available: samples.filter((s) => s.status === "available").length,
      assigned: samples.filter((s) => s.status === "assigned").length,
      completed: samples.filter((s) => s.status === "completed").length,
    };
  }, [samples]);

  const hasActiveFilters = langFilter !== "all" || catFilter !== "all" || statusFilter !== "all" || search !== "";

  return (
    <motion.div
      className="p-4 lg:p-6 flex flex-col gap-4"
      initial="hidden"
      animate="visible"
      variants={pageStagger}
    >
      {/* Header */}
      <motion.div variants={pageFadeUp}>
        <div className="flex items-center gap-2 mb-1">
          <Target className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold font-heading tracking-tight">Theme Samples</h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{counts.total} total</span>
          <span className="text-emerald-500">{counts.available} available</span>
          <span className="text-amber-500">{counts.assigned} assigned</span>
          <span className="text-blue-500">{counts.completed} completed</span>
          {hasActiveFilters && <span>&middot; {filtered.length} matching</span>}
        </div>
      </motion.div>

      {/* Toolbar: search + filters */}
      <motion.div variants={pageFadeUp} className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search values, capture ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-xs"
          />
        </div>

        <Select value={langFilter} onValueChange={(v) => v && setLangFilter(v)}>
          <SelectTrigger className="w-[120px] h-8 text-xs">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Languages</SelectItem>
            {Object.entries(LANG_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={catFilter} onValueChange={(v) => v && setCatFilter(v)}>
          <SelectTrigger className="w-[150px] h-8 text-xs">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="w-[120px] h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => { setLangFilter("all"); setCatFilter("all"); setStatusFilter("all"); setSearch(""); }}
          >
            Clear
          </Button>
        )}
      </motion.div>

      {/* Table */}
      <motion.div variants={pageFadeUp} className="border rounded-lg overflow-hidden overflow-x-auto flex-1">
        {isPending ? (
          <div className="space-y-0">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50">
                <Skeleton className="size-4 rounded" />
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {hasActiveFilters ? "No samples match your filters" : "No theme samples found"}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 pl-3" />
                <TableHead className="w-16">ID</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Capture</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((sample) => {
                const isExpanded = expandedId === sample.id;
                const st = STATUS_STYLES[sample.status] ?? STATUS_STYLES.available;
                const fields = Object.entries(sample.data);

                return (
                  <React.Fragment key={sample.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : sample.id)}
                    >
                      <TableCell className="pl-3 w-8">
                        {isExpanded
                          ? <ChevronDown className="size-4 text-muted-foreground" />
                          : <ChevronRight className="size-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        #{sample.id}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {LANG_LABELS[sample.language] ?? sample.language}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {CATEGORY_LABELS[sample.category] ?? sample.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs border-transparent ${st.className}`}>
                          {st.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {sample.assignedCaptureId ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs gap-1 text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/dashboard/tasks/${sample.assignedCaptureId}/themed`);
                            }}
                          >
                            {sample.assignedCaptureId.slice(0, 8)}...
                            <ExternalLink className="size-3" />
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">&mdash;</span>
                        )}
                      </TableCell>
                    </TableRow>

                    {/* Expanded row: show all values */}
                    {isExpanded && (
                      <TableRow key={`${sample.id}-detail`} className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={6} className="p-0">
                          <div className="px-4 sm:px-6 py-4 space-y-3">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              Sample Values &middot; {fields.length} fields
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {fields.map(([key, value]) => (
                                <div key={key} className="rounded-lg border bg-background p-2.5">
                                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                                    {formatFieldLabel(key)}
                                  </p>
                                  <p className="text-sm break-all">{value}</p>
                                </div>
                              ))}
                            </div>
                            {sample.assignedAt && (
                              <p className="text-[10px] text-muted-foreground">
                                Assigned: {new Date(sample.assignedAt).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </motion.div>

      {/* Pagination */}
      {filtered.length > PAGE_SIZE && (
        <motion.div variants={pageFadeUp} className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeftIcon className="size-4" />
              <span className="hidden sm:inline">Previous</span>
            </Button>
            {/* Page numbers */}
            {Array.from({ length: totalPages }).map((_, i) => {
              // Show first, last, current, and neighbors
              const show = i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 1;
              const showEllipsis = !show && (i === 1 || i === totalPages - 2);
              if (showEllipsis) return <span key={i} className="px-1 text-xs text-muted-foreground">&hellip;</span>;
              if (!show) return null;
              return (
                <Button
                  key={i}
                  variant={i === page ? "default" : "outline"}
                  size="sm"
                  className="h-8 w-8 p-0 text-xs"
                  onClick={() => setPage(i)}
                >
                  {i + 1}
                </Button>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
