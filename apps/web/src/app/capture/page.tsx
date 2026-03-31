"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LoaderCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useCaptures, useCreateCapture } from "@/lib/api";

const statusConfig: Record<string, { label: string; className: string; dot: string; pulse?: boolean }> = {
  created:   { label: "Created",   className: "bg-zinc-800 text-zinc-400 border-zinc-700",          dot: "bg-zinc-500" },
  calling:   { label: "Calling",   className: "bg-yellow-950 text-yellow-400 border-yellow-900",    dot: "bg-yellow-400", pulse: true },
  active:    { label: "Live",      className: "bg-emerald-950 text-emerald-400 border-emerald-900", dot: "bg-emerald-400", pulse: true },
  ended:     { label: "Ended",     className: "bg-zinc-800 text-zinc-400 border-zinc-700",          dot: "bg-zinc-500" },
  completed: { label: "Completed", className: "bg-blue-950 text-blue-400 border-blue-900",          dot: "bg-blue-400" },
};

function formatDuration(s?: number | null) {
  if (!s) return "—";
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
        {Array.from({ length: 3 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell className="pl-6"><Skeleton className="h-4 w-28" /></TableCell>
            <TableCell><Skeleton className="h-4 w-44" /></TableCell>
            <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
            <TableCell><Skeleton className="h-4 w-10" /></TableCell>
            <TableCell><Skeleton className="h-4 w-16" /></TableCell>
            <TableCell className="pr-6"><Skeleton className="h-4 w-4 ml-auto" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function CaptureDashboard() {
  const router = useRouter();
  const { data: captures = [], isLoading, error } = useCaptures();
  const createMutation = useCreateCapture();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phoneA, setPhoneA] = useState("");
  const [phoneB, setPhoneB] = useState("");
  const [language, setLanguage] = useState("en");

  const creating = createMutation.isPending;

  const liveCount = captures.filter((c) => c.status === "active" || c.status === "calling").length;
  const completedCount = captures.filter((c) => c.status === "completed").length;

  async function create() {
    const result = await createMutation.mutateAsync({ name, phoneA, phoneB, language });
    toast.success("Capture created");
    setOpen(false);
    setName(""); setPhoneA(""); setPhoneB(""); setLanguage("en");
    router.push(`/capture/${result.id}`);
  }

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Voice Capture Platform</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bridge two phone numbers. Record. Get dual-channel audio for ASR datasets.
          </p>
          {!isLoading && !error && captures.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {captures.length} capture{captures.length !== 1 ? "s" : ""}
              {liveCount > 0 && (
                <> · <span className="text-emerald-400">{liveCount} live</span></>
              )}
              {completedCount > 0 && (
                <> · {completedCount} completed</>
              )}
            </p>
          )}
        </div>
        <Button onClick={() => setOpen(true)}>New Capture</Button>
      </div>

      {/* Table — border-only container, no background color difference */}
      <div className="rounded-lg border border-border overflow-hidden">
          {isLoading ? (
            <TableSkeleton />
          ) : error ? (
            <div className="py-12 text-center space-y-3 px-6">
              <p className="font-medium">Failed to load captures</p>
              <p className="text-sm text-muted-foreground">{error.message}</p>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          ) : captures.length === 0 ? (
            <div className="py-16 text-center px-6">
              <Phone className="h-8 w-8 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="font-medium">No captures yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Click &quot;New Capture&quot; to bridge two phone numbers and start recording.
              </p>
            </div>
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
                {captures.map((c) => {
                  const sc = statusConfig[c.status] ?? statusConfig.created;
                  return (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/capture/${c.id}`)}
                    >
                      <TableCell className="pl-6 font-medium">{c.name || "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {c.phoneA} / {c.phoneB}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={sc.className}>
                          <span
                            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${sc.dot}${sc.pulse ? " animate-pulse" : ""}`}
                          />
                          {sc.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm tabular-nums">
                        {formatDuration(c.durationSeconds)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatRelativeTime(c.createdAt)}
                      </TableCell>
                      <TableCell className="pr-6">
                        <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
      </div>

      {/* New Capture dialog */}
      <Dialog open={open} onOpenChange={(v) => { if (!creating) setOpen(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Capture</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="e.g. Hindi Customer Call"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Phone A</label>
              <Input
                placeholder="+91XXXXXXXXXX"
                value={phoneA}
                onChange={(e) => setPhoneA(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Phone B</label>
              <Input
                placeholder="+91XXXXXXXXXX"
                value={phoneB}
                onChange={(e) => setPhoneB(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Language</label>
              <Select value={language} onValueChange={(v) => setLanguage(v ?? "en")} disabled={creating}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="hi">Hindi</SelectItem>
                  <SelectItem value="kn">Kannada</SelectItem>
                  <SelectItem value="te">Telugu</SelectItem>
                  <SelectItem value="ta">Tamil</SelectItem>
                  <SelectItem value="mr">Marathi</SelectItem>
                  <SelectItem value="multi">Multi-lingual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              onClick={create}
              disabled={!phoneA || !phoneB || creating}
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
