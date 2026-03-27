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
import type { SessionSummary, ScriptStep } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const statusColors: Record<string, string> = {
  created: "bg-zinc-700 text-zinc-300",
  calling: "bg-yellow-900 text-yellow-300",
  active: "bg-green-900 text-green-300",
  ended: "bg-zinc-800 text-zinc-400",
};

export default function Dashboard() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [open, setOpen] = useState(false);

  const [scenarioName, setScenarioName] = useState("");
  const [persona, setPersona] = useState("");
  const [agentPhone, setAgentPhone] = useState("");
  const [testerPhone, setTesterPhone] = useState("");
  const [scriptText, setScriptText] = useState(
    "Greet the agent and ask about available services\nAsk about pricing details\nAsk about payment methods\nThank them and end the call"
  );

  async function loadSessions() {
    const res = await fetch(`${API}/api/sessions`);
    if (res.ok) setSessions(await res.json());
  }

  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  async function createSession() {
    const script: ScriptStep[] = scriptText
      .split("\n")
      .filter((l) => l.trim())
      .map((prompt, i) => ({ id: i + 1, prompt: prompt.trim() }));

    const res = await fetch(`${API}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario: { name: scenarioName, persona, agentPhone, script },
        testerPhone,
      }),
    });

    if (res.ok) {
      const session = await res.json();
      toast.success(`Session ${session.id} created`);
      setOpen(false);
      loadSessions();
      router.push(`/session/${session.id}`);
    } else {
      const err = await res.json();
      toast.error(err.error || "Failed to create session");
    }
  }

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Voice Agent Testing Platform
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Test voice AI agents with real human testers. Record, transcribe,
            and evaluate.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/capture")}>
            ASR Data Capture
          </Button>
          <Button onClick={() => setOpen(true)}>New Test Session</Button>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Test Session</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <label className="text-sm font-medium">Scenario Name</label>
                <Input
                  placeholder="e.g. Kotak Home Loan Inquiry"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Persona</label>
                <Input
                  placeholder="e.g. Kannada-speaking user asking about home loans"
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  Agent Phone Number
                </label>
                <Input
                  placeholder="+91XXXXXXXXXX"
                  value={agentPhone}
                  onChange={(e) => setAgentPhone(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  Tester Phone Number
                </label>
                <Input
                  placeholder="+91XXXXXXXXXX"
                  value={testerPhone}
                  onChange={(e) => setTesterPhone(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  Test Script (one prompt per line)
                </label>
                <textarea
                  className="w-full h-32 rounded-md border bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={createSession}
                disabled={!scenarioName || !agentPhone || !testerPhone}
              >
                Create & Open Session
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No test sessions yet. Create one to get started.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Test Sessions</CardTitle>
            <CardDescription>
              {sessions.length} session{sessions.length !== 1 && "s"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scenario</TableHead>
                  <TableHead>Persona</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transcript</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/session/${s.id}`)}
                  >
                    <TableCell className="font-medium">
                      {s.scenario.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-48 truncate">
                      {s.scenario.persona}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[s.status] ?? ""}>
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {s.transcriptCount} lines
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(s.createdAt).toLocaleString()}
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
