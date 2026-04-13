"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Target,
  ExternalLink,
  ListFilter,
} from "lucide-react";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const statusStyles: Record<string, { label: string; className: string }> = {
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

export default function AdminThemesPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: samples, isPending } = useAdminThemeSamples();

  const [langFilter, setLangFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (session && (session.user as any)?.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [session, router]);

  const filtered = useMemo(() => {
    if (!samples) return [];
    return samples.filter((s) => {
      if (langFilter !== "all" && s.language !== langFilter) return false;
      if (catFilter !== "all" && s.category !== catFilter) return false;
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      return true;
    });
  }, [samples, langFilter, catFilter, statusFilter]);

  // Summary counts
  const counts = useMemo(() => {
    if (!samples) return { total: 0, available: 0, assigned: 0, completed: 0 };
    return {
      total: samples.length,
      available: samples.filter((s) => s.status === "available").length,
      assigned: samples.filter((s) => s.status === "assigned").length,
      completed: samples.filter((s) => s.status === "completed").length,
    };
  }, [samples]);

  const hasActiveFilters = langFilter !== "all" || catFilter !== "all" || statusFilter !== "all";

  return (
    <motion.div
      className="p-4 lg:p-6 space-y-4"
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
        <p className="text-sm text-muted-foreground">
          {counts.total} total &middot; {counts.available} available &middot; {counts.assigned} assigned &middot; {counts.completed} completed
          {hasActiveFilters && ` · Showing ${filtered.length}`}
        </p>
      </motion.div>

      {/* Filters */}
      <motion.div variants={pageFadeUp} className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ListFilter className="size-3.5" />
          <span className="hidden sm:inline">Filter:</span>
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
          <SelectTrigger className="w-[130px] h-8 text-xs">
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
            onClick={() => { setLangFilter("all"); setCatFilter("all"); setStatusFilter("all"); }}
          >
            Clear
          </Button>
        )}
      </motion.div>

      {/* Table */}
      <motion.div variants={pageFadeUp} className="border rounded-lg overflow-hidden overflow-x-auto">
        {isPending ? (
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50">
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-20 ml-auto" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {hasActiveFilters ? "No samples match filters" : "No theme samples found"}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-3" />
                <TableHead>ID</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Capture</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((sample) => {
                const isExpanded = expandedId === sample.id;
                const st = statusStyles[sample.status] ?? statusStyles.available;
                const fields = Object.entries(sample.data);

                return (
                  <>
                    <TableRow
                      key={sample.id}
                      className="cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : sample.id)}
                    >
                      <TableCell className="pl-3 w-10">
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
                          <span className="text-xs text-muted-foreground/50">&mdash;</span>
                        )}
                      </TableCell>
                    </TableRow>

                    {/* Expanded: show all key-value pairs */}
                    {isExpanded && (
                      <TableRow key={`${sample.id}-expanded`} className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={6} className="p-0">
                          <div className="px-6 py-4 space-y-3">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              Sample Values ({fields.length} fields)
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
                  </>
                );
              })}
            </TableBody>
          </Table>
        )}
      </motion.div>
    </motion.div>
  );
}
