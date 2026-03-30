"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

export default function CaptureDashboard() {
  const router = useRouter();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phoneA, setPhoneA] = useState("");
  const [phoneB, setPhoneB] = useState("");
  const [language, setLanguage] = useState("en");

  async function load() {
    const res = await fetch(`${API}/api/captures`);
    if (res.ok) setCaptures(await res.json());
  }

  useEffect(() => {
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);

  async function create() {
    const res = await fetch(`${API}/api/captures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phoneA, phoneB, language }),
    });
    if (res.ok) {
      const c = await res.json();
      toast.success(`Capture ${c.id} created`);
      setOpen(false);
      router.push(`/capture/${c.id}`);
    } else {
      toast.error((await res.json()).error);
    }
  }

  const formatDuration = (s?: number | null) => {
    if (!s) return "—";
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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>New Capture</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input placeholder="e.g. Hindi Customer Call" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium">Phone A</label>
                <Input placeholder="+91XXXXXXXXXX" value={phoneA} onChange={(e) => setPhoneA(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium">Phone B</label>
                <Input placeholder="+91XXXXXXXXXX" value={phoneB} onChange={(e) => setPhoneB(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium">Language</label>
                <Input placeholder="en, hi, kn, multi..." value={language} onChange={(e) => setLanguage(e.target.value)} />
              </div>
              <Button className="w-full" onClick={create} disabled={!phoneA || !phoneB}>
                Create & Open
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {captures.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No captures yet.
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
