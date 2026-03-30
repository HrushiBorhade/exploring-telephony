"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import type { Capture } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const statusColors: Record<string, string> = {
  created: "bg-zinc-700 text-zinc-300",
  calling: "bg-yellow-900 text-yellow-300",
  active: "bg-green-900 text-green-300",
  ended: "bg-blue-900 text-blue-300",
  completed: "bg-emerald-900 text-emerald-300",
};

// --- Skeleton for the table while initial data loads ---
function DashboardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-16 mt-1" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Table header skeleton */}
          <div className="grid grid-cols-6 gap-4 pb-2 border-b border-border">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-12" />
          </div>
          {/* Row skeletons */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="grid grid-cols-6 gap-4 py-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CaptureDashboard() {
  const router = useRouter();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phoneA, setPhoneA] = useState("");
  const [phoneB, setPhoneB] = useState("");
  const [language, setLanguage] = useState("en");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/captures`);
      if (res.ok) {
        setCaptures(await res.json());
        setLoadError(null);
      } else {
        const errText = await res.text().catch(() => "Unknown error");
        setLoadError(`Server returned ${res.status}: ${errText}`);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Network error — is the API server running?");
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, [load]);

  async function create() {
    setCreating(true);
    try {
      const res = await fetch(`${API}/api/captures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phoneA, phoneB, language }),
      });
      if (res.ok) {
        const c = await res.json();
        toast.success(`Capture ${c.id} created`);
        setOpen(false);
        // Reset form
        setName("");
        setPhoneA("");
        setPhoneB("");
        setLanguage("en");
        router.push(`/capture/${c.id}`);
      } else {
        const body = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
        toast.error(body.error || "Failed to create capture");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error — could not reach the API server");
    } finally {
      setCreating(false);
    }
  }

  const formatDuration = (s?: number | null) => {
    if (!s) return "\u2014";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Voice Capture Platform</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bridge two phone numbers. Record. Get dual-channel audio for ASR datasets.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>New Capture</Button>
        <Dialog open={open} onOpenChange={(v) => { if (!creating) setOpen(v); }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>New Capture</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  placeholder="e.g. Hindi Customer Call"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={creating}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Phone A</label>
                <Input
                  placeholder="+91XXXXXXXXXX"
                  value={phoneA}
                  onChange={(e) => setPhoneA(e.target.value)}
                  disabled={creating}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Phone B</label>
                <Input
                  placeholder="+91XXXXXXXXXX"
                  value={phoneB}
                  onChange={(e) => setPhoneB(e.target.value)}
                  disabled={creating}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Language</label>
                <Input
                  placeholder="en, hi, kn, multi..."
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={creating}
                />
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

      {/* Initial loading state: show skeleton */}
      {initialLoading ? (
        <DashboardSkeleton />
      ) : loadError ? (
        /* Error state when API is unreachable */
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
              <span className="text-destructive text-xl">!</span>
            </div>
            <div>
              <p className="font-medium">Failed to load captures</p>
              <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
            </div>
            <Button variant="outline" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : captures.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No captures yet. Click &quot;New Capture&quot; to get started.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Captures</CardTitle>
            <CardDescription>{captures.length} total</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phones</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {captures.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/capture/${c.id}`)}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{c.phoneA} / {c.phoneB}</TableCell>
                    <TableCell><Badge className={statusColors[c.status] ?? ""}>{c.status}</Badge></TableCell>
                    <TableCell className="font-mono text-sm">{formatDuration(c.durationSeconds)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(c.createdAt).toLocaleString()}</TableCell>
                    <TableCell><Button variant="ghost" size="sm">Open</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
