"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Search, Filter } from "lucide-react";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminCaptures } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import type { Capture } from "@/lib/types";

const statusConfig: Record<string, { label: string; className: string; dot: string }> = {
  created:    { label: "Created",    className: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",               dot: "bg-zinc-400" },
  calling:    { label: "Calling",    className: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-900",     dot: "bg-yellow-500" },
  active:     { label: "Live",       className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900", dot: "bg-emerald-500" },
  ended:      { label: "Ended",      className: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",               dot: "bg-zinc-400" },
  processing: { label: "Processing", className: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:border-purple-900",     dot: "bg-purple-500" },
  failed:     { label: "Failed",     className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900",                       dot: "bg-red-500" },
  completed:  { label: "Completed",  className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900",                 dot: "bg-blue-500" },
};

function formatDuration(s?: number | null) {
  if (s == null) return "\u2014";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function TableSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5 border-b border-border/50">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-12 ml-auto" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export default function AdminCapturesPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useAdminCaptures();

  // Guard
  useEffect(() => {
    if (session && (session.user as any)?.role !== "admin") {
      router.replace("/capture");
    }
  }, [session, router]);

  const allCaptures = data?.pages.flatMap((p) => p.items) ?? [];

  // Client-side filter (API returns all, we filter here for instant UX)
  const filtered = allCaptures.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.name?.toLowerCase().includes(q) ||
        c.phoneA?.includes(q) ||
        c.phoneB?.includes(q) ||
        c.id?.includes(q)
      );
    }
    return true;
  });

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
          {allCaptures.length} total {statusFilter !== "all" ? `\u00B7 ${filtered.length} ${statusFilter}` : ""}
        </p>
      </motion.div>

      <motion.div variants={pageFadeUp} className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="w-36">
            <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="active">Live</SelectItem>
            <SelectItem value="ended">Ended</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="calling">Calling</SelectItem>
          </SelectContent>
        </Select>
      </motion.div>

      <motion.div variants={pageFadeUp} className="border rounded-lg overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No captures found</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Phones</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((capture, i) => {
                const cfg = statusConfig[capture.status] ?? statusConfig.created;
                return (
                  <TableRow
                    key={capture.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => router.push(`/capture/${capture.id}`)}
                    style={{ animation: `fade-in-up 0.3s ease-out backwards`, animationDelay: `${i * 20}ms` }}
                  >
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {capture.phoneA?.slice(-4) ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium max-w-[180px] truncate">
                      {capture.name || "Untitled"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {capture.phoneA} / {capture.phoneB}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${cfg.className}`}>
                        <span className={`mr-1 inline-block size-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDuration(capture.durationSeconds)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {timeAgo(capture.createdAt)}
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="size-4 text-muted-foreground" />
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
