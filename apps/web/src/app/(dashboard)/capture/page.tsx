"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LoaderCircle, AudioWaveform, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useCaptures, useCreateCapture } from "@/lib/api";
import { SectionCards } from "@/components/section-cards";

const statusConfig: Record<string, { label: string; className: string; dot: string; pulse?: boolean }> = {
  created:    { label: "Created",    className: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",               dot: "bg-zinc-400 dark:bg-zinc-500" },
  calling:    { label: "Calling",    className: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-900",     dot: "bg-yellow-500 dark:bg-yellow-400", pulse: true },
  active:     { label: "Live",       className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900", dot: "bg-emerald-500 dark:bg-emerald-400", pulse: true },
  ended:      { label: "Ended",      className: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",               dot: "bg-zinc-400 dark:bg-zinc-500" },
  processing: { label: "Processing", className: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:border-purple-900",     dot: "bg-purple-500 dark:bg-purple-400", pulse: true },
  failed:     { label: "Failed",     className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900",                       dot: "bg-red-500 dark:bg-red-400" },
  completed:  { label: "Completed",  className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900",                 dot: "bg-blue-500 dark:bg-blue-400" },
};

function formatDuration(s?: number | null) {
  if (s == null) return "\u2014";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatRelativeTime(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const skeletonWidths = [
  { name: "w-24", phones: "w-40", status: "w-20", dur: "w-10", time: "w-14" },
  { name: "w-32", phones: "w-44", status: "w-18", dur: "w-8",  time: "w-16" },
  { name: "w-20", phones: "w-36", status: "w-22", dur: "w-10", time: "w-12" },
];

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const w = skeletonWidths[i % skeletonWidths.length];
        const delay = `${i * 75}ms`;
        return (
          <TableRow key={`skeleton-${i}`}>
            <TableCell className="pl-6"><Skeleton className={`h-4 ${w.name}`} /></TableCell>
            <TableCell><Skeleton className={`h-4 ${w.phones}`} /></TableCell>
            <TableCell><Skeleton className={`h-5 ${w.status} rounded-full`} /></TableCell>
            <TableCell><Skeleton className={`h-4 ${w.dur}`} /></TableCell>
            <TableCell><Skeleton className={`h-4 ${w.time}`} /></TableCell>
            <TableCell className="pr-6"><Skeleton className="h-4 w-4 ml-auto" /></TableCell>
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
          <TableHead className="pl-6">Name</TableHead>
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

const fadeUp = pageFadeUp;
const stagger = pageStagger;

export default function CaptureDashboard() {
  const router = useRouter();
  const {
    data,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isError,
    refetch,
  } = useCaptures();
  const createMutation = useCreateCapture();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [phoneB, setPhoneB] = useState("");
  const language = "multi";

  const creating = createMutation.isPending;

  useEffect(() => {
    function handleOpen() { setOpen(true); }
    window.addEventListener("open-new-capture", handleOpen);
    return () => window.removeEventListener("open-new-capture", handleOpen);
  }, []);

  // Flatten paginated data
  const captures = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  );

  // Intersection observer for infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  const observerCallback = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage && !isError) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, isError, fetchNextPage]
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(observerCallback, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [observerCallback]);

  async function create() {
    try {
      const fullPhone = `${countryCode}${phoneB.replace(/\D/g, "")}`;
      const result = await createMutation.mutateAsync({ name, phoneB: fullPhone, language });
      toast.success("Capture created");
      setOpen(false);
      setName("");
      setPhoneB("");
      router.push(`/capture/${result.id}`);
    } catch {
      // onError in useCreateCapture already shows the toast
    }
  }

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <SectionCards />
        <motion.div
          className="px-4 lg:px-6"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          <motion.div variants={fadeUp} className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">All Captures</h2>
            </div>
            <Button onClick={() => setOpen(true)}>New Capture</Button>
          </motion.div>

          <motion.div variants={fadeUp} className="rounded-lg border border-border overflow-hidden">
          {/* ── Initial loading ── */}
          {isLoading ? (
            <TableSkeleton />

          /* ── Initial error (no data at all) ── */
          ) : isError && captures.length === 0 ? (
            <div className="py-12 text-center space-y-3 px-6">
              <AlertCircle className="size-8 mx-auto text-muted-foreground/40" />
              <p className="font-medium">Failed to load captures</p>
              <p className="text-sm text-muted-foreground">{error?.message}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>

          /* ── Empty state ── */
          ) : captures.length === 0 ? (
            <div className="py-20 text-center px-6">
              <div className="inline-flex items-center justify-center size-12 rounded-xl bg-muted/50 mb-4">
                <AudioWaveform className="size-5 text-muted-foreground/50" />
              </div>
              <p className="font-medium text-sm">No captures yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-[260px] mx-auto">
                Click &quot;New Capture&quot; to bridge two phone numbers and start recording.
              </p>
            </div>

          /* ── Data loaded — table ── */
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Phones</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {captures.map((c, i) => {
                  const callFailed = c.status === "ended" && !c.startedAt;
                  const sc = callFailed
                    ? statusConfig.failed
                    : (statusConfig[c.status] ?? statusConfig.created);
                  return (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer group/row transition-colors hover:bg-muted/40"
                      tabIndex={0}
                      role="link"
                      onClick={() => router.push(`/capture/${c.id}`)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(`/capture/${c.id}`); }}
                      style={{
                        animation: "fade-in-up 0.3s ease-out backwards",
                        animationDelay: `${Math.min(i, 10) * 40}ms`,
                      }}
                    >
                      <TableCell className="pl-6 font-medium max-w-[180px] truncate">{c.name || "\u2014"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-[200px] truncate">
                        {c.phoneA} / {c.phoneB}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`transition-colors ${sc.className}`}>
                          <span
                            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${sc.dot}${sc.pulse ? " animate-pulse" : ""}`}
                          />
                          {sc.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm tabular-nums">
                        {formatDuration(c.durationSeconds)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm" suppressHydrationWarning>
                        {formatRelativeTime(c.createdAt)}
                      </TableCell>
                      <TableCell className="pr-6">
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 ml-auto transition-all group-hover/row:text-muted-foreground group-hover/row:translate-x-0.5" />
                      </TableCell>
                    </TableRow>
                  );
                })}

                {/* ── Loading next page ── */}
                {isFetchingNextPage && <SkeletonRows count={2} />}
              </TableBody>
            </Table>
          )}
          </motion.div>

          {/* ── Infinite scroll sentinel + states (below table border) ── */}
          {captures.length > 0 && (
            <div className="pt-3 pb-1">
              {/* Error loading next page */}
              {isError && captures.length > 0 && !isFetchingNextPage && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <AlertCircle className="size-3.5 text-destructive" />
                  <span className="text-sm text-muted-foreground">Failed to load more</span>
                  <Button variant="ghost" size="xs" onClick={() => fetchNextPage()}>
                    Retry
                  </Button>
                </div>
              )}

              {/* Sentinel for auto-load */}
              {hasNextPage && !isError && (
                <div ref={sentinelRef} className="h-1" />
              )}

              {/* Loading indicator for next page (below table) */}
              {isFetchingNextPage && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading more captures...</span>
                </div>
              )}

              {/* End of list */}
              {!hasNextPage && !isLoading && captures.length > 0 && (
                <p className="text-center text-xs text-muted-foreground/50 py-1">
                  All {captures.length} captures loaded
                </p>
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* ── New Capture dialog ── */}
      <Dialog open={open} onOpenChange={(v) => { if (!creating) setOpen(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Capture</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label htmlFor="capture-name" className="text-sm font-medium">Name</label>
              <Input
                id="capture-name"
                placeholder="e.g. Hindi Customer Call"
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="capture-phone-b" className="text-sm font-medium">Phone B</label>
              <div className="flex items-center gap-2">
                <Select value={countryCode} onValueChange={(v) => setCountryCode(v ?? "+91")} disabled={creating}>
                  <SelectTrigger className="w-[90px] shrink-0 font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="+91">+91</SelectItem>
                    <SelectItem value="+1">+1</SelectItem>
                    <SelectItem value="+44">+44</SelectItem>
                    <SelectItem value="+971">+971</SelectItem>
                    <SelectItem value="+65">+65</SelectItem>
                    <SelectItem value="+61">+61</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  id="capture-phone-b"
                  type="tel"
                  inputMode="numeric"
                  placeholder="9876543210"
                  maxLength={10}
                  value={phoneB}
                  onChange={(e) => setPhoneB(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  disabled={creating}
                  className="font-mono tracking-widest"
                />
              </div>
            </div>
            <Button
              className="w-full"
              onClick={create}
              disabled={phoneB.replace(/\D/g, "").length !== 10 || creating}
            >
              {creating ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create & Open"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
