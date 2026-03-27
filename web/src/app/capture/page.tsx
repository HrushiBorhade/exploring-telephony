"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import type { CaptureSummary } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const statusColors: Record<string, string> = {
  created: "bg-zinc-700 text-zinc-300",
  calling: "bg-yellow-900 text-yellow-300",
  active: "bg-green-900 text-green-300",
  ended: "bg-zinc-800 text-zinc-400",
};

export default function CaptureDashboard() {
  const router = useRouter();
  const [captures, setCaptures] = useState<CaptureSummary[]>([]);
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [phoneA, setPhoneA] = useState("");
  const [phoneB, setPhoneB] = useState("");
  const [language, setLanguage] = useState("en");

  async function loadCaptures() {
    const res = await fetch(`${API}/api/captures`);
    if (res.ok) setCaptures(await res.json());
  }

  useEffect(() => {
    loadCaptures();
    const interval = setInterval(loadCaptures, 5000);
    return () => clearInterval(interval);
  }, []);

  async function createCapture() {
    const res = await fetch(`${API}/api/captures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phoneA, phoneB, language }),
    });

    if (res.ok) {
      const capture = await res.json();
      toast.success(`Capture ${capture.id} created`);
      setOpen(false);
      loadCaptures();
      router.push(`/capture/${capture.id}`);
    } else {
      const err = await res.json();
      toast.error(err.error || "Failed to create capture");
    }
  }

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
              Agent Testing
            </Button>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-2xl font-semibold tracking-tight">
              ASR Data Capture
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Record conversations between two phone numbers. Transcribe and
            export as ASR training datasets.
          </p>
        </div>

        <Button onClick={() => setOpen(true)}>New Capture</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>New Phone-to-Phone Capture</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <label className="text-sm font-medium">Capture Name</label>
                <Input
                  placeholder="e.g. Customer Service Call - Hindi"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Phone A</label>
                <Input
                  placeholder="+91XXXXXXXXXX"
                  value={phoneA}
                  onChange={(e) => setPhoneA(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Phone B</label>
                <Input
                  placeholder="+91XXXXXXXXXX"
                  value={phoneB}
                  onChange={(e) => setPhoneB(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Language</label>
                <Input
                  placeholder="en, hi, kn, ta, multi..."
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Deepgram Nova-3 language code. Use &quot;multi&quot; for auto-detect.
                </p>
              </div>
              <Button
                className="w-full"
                onClick={createCapture}
                disabled={!phoneA || !phoneB}
              >
                Create & Open
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {captures.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No captures yet. Create one to start recording.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Captures</CardTitle>
            <CardDescription>
              {captures.length} capture{captures.length !== 1 && "s"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phones</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transcript</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {captures.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/capture/${c.id}`)}
                  >
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {c.phoneA} / {c.phoneB}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{c.language}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[c.status] ?? ""}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {c.transcriptCount} lines
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(c.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">
                        Open
                      </Button>
                    </TableCell>
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
