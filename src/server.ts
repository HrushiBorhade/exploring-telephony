import "dotenv/config";
import express from "express";
import { createServer } from "http";
import twilio from "twilio";
import { WebSocketServer, WebSocket } from "ws";
// Using raw WebSocket for Deepgram (SDK v5 has connection issues)
import crypto from "crypto";
import * as dbq from "./db/queries";
import { writeMulawWav } from "./audio";
import type {
  Session,
  TestScenario,
  TranscriptEntry,
  ClientMessage,
  Capture,
  CaptureTranscriptEntry,
} from "./types";

// ════════════════════════════════════════════════════════════════════
// Config
// ════════════════════════════════════════════════════════════════════

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  DEEPGRAM_API_KEY,
  BASE_URL,
  PORT = "3001",
} = process.env;

const missing = [
  !TWILIO_ACCOUNT_SID && "TWILIO_ACCOUNT_SID",
  !TWILIO_AUTH_TOKEN && "TWILIO_AUTH_TOKEN",
  !TWILIO_PHONE_NUMBER && "TWILIO_PHONE_NUMBER",
  !DEEPGRAM_API_KEY && "DEEPGRAM_API_KEY",
  !BASE_URL && "BASE_URL",
].filter(Boolean);

if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}. See .env.example`);
  process.exit(1);
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID!, TWILIO_AUTH_TOKEN!);
const VoiceResponse = twilio.twiml.VoiceResponse;
// Deepgram via raw WebSocket (see openDeepgramWs function)

// Derive WSS URL from BASE_URL (ngrok forwards wss→ws automatically)
const WS_URL = BASE_URL!.replace(/^https?/, "wss");

// ════════════════════════════════════════════════════════════════════
// In-memory session store
// ════════════════════════════════════════════════════════════════════

const sessions = new Map<string, Session>();

function createSession(
  scenario: TestScenario,
  testerPhone: string
): Session {
  const id = crypto.randomBytes(6).toString("hex");
  const session: Session = {
    id,
    scenario,
    testerPhone,
    status: "created",
    conferenceName: `test-${id}`,
    transcript: [],
    currentScriptStep: 0,
    createdAt: new Date().toISOString(),
  };
  sessions.set(id, session);
  return session;
}

// ── Capture store (phone-to-phone mode) ─────────────────────────────

const captures = new Map<string, Capture>();

function createCapture(name: string, phoneA: string, phoneB: string, language: string): Capture {
  const id = crypto.randomBytes(6).toString("hex");
  const capture: Capture = {
    id,
    name,
    phoneA,
    phoneB,
    language: language || "en",
    status: "created",
    conferenceName: `cap-${id}`,
    transcript: [],
    createdAt: new Date().toISOString(),
  };
  captures.set(id, capture);
  return capture;
}

// ════════════════════════════════════════════════════════════════════
// Client WebSocket — push live updates to frontend
// ════════════════════════════════════════════════════════════════════

// sessionId → Set of connected frontend WebSocket clients
const clientSockets = new Map<string, Set<WebSocket>>();

function broadcastToSession(sessionId: string, msg: ClientMessage) {
  const clients = clientSockets.get(sessionId);
  if (!clients) return;
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// ════════════════════════════════════════════════════════════════════
// Deepgram ASR — stream audio → get transcripts
// ════════════════════════════════════════════════════════════════════

// ── Deepgram handle with reconnection + buffering ───────────────────

class DgHandle {
  ws: WebSocket | null = null;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private maxReconnects = 5;
  private closed = false;
  private pendingBuffer: Buffer[] = [];
  private maxBufferSize = 8 * 1024; // 8KB max buffer
  private bufferSize = 0;

  constructor(
    private language: string,
    private sessionId: string,
    private speakerLabel: string,
    private onTranscript: (text: string, isFinal: boolean, words: { word: string; start: number; end: number; confidence: number }[], startTime: number, endTime: number) => void,
  ) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;

    const params = new URLSearchParams({
      model: "nova-3",
      language: this.language,
      encoding: "mulaw",
      sample_rate: "8000",
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      utterance_end_ms: "1000",
      endpointing: "300",
    });

    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    });

    ws.on("open", () => {
      console.log(`[DG] ${this.speakerLabel}@${this.sessionId} connected (attempt ${this.reconnectAttempts})`);
      this.reconnectAttempts = 0;

      // Flush any buffered audio
      for (const chunk of this.pendingBuffer) {
        ws.send(chunk);
      }
      this.pendingBuffer = [];
      this.bufferSize = 0;
    });

    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type !== "Results") return;
        const alt = data.channel?.alternatives?.[0];
        const transcript = alt?.transcript;
        if (!transcript) return;

        // Extract word-level timestamps from Deepgram response
        const words = (alt.words ?? []).map((w: any) => ({
          word: w.punctuated_word ?? w.word,
          start: w.start,
          end: w.end,
          confidence: w.confidence,
        }));

        const startTime = data.start ?? 0;
        const endTime = startTime + (data.duration ?? 0);

        this.onTranscript(transcript, data.is_final ?? false, words, startTime, endTime);
      } catch {
        // Ignore parse errors
      }
    });

    ws.on("error", (err) => {
      console.error(`[DG] ${this.speakerLabel}@${this.sessionId} error:`, err.message);
    });

    ws.on("close", (code) => {
      console.log(`[DG] ${this.speakerLabel}@${this.sessionId} closed (code: ${code})`);
      this.stopKeepAlive();

      // Reconnect if not intentionally closed
      if (!this.closed && this.reconnectAttempts < this.maxReconnects) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 8000);
        console.log(`[DG] ${this.speakerLabel}@${this.sessionId} reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        setTimeout(() => this.connect(), delay);
      }
    });

    this.ws = ws;
    this.startKeepAlive();
  }

  sendAudio(buffer: Buffer) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    } else {
      // Buffer audio while reconnecting (cap at maxBufferSize)
      if (this.bufferSize + buffer.length <= this.maxBufferSize) {
        this.pendingBuffer.push(buffer);
        this.bufferSize += buffer.length;
      }
      // Drop oldest chunks if buffer full
      while (this.bufferSize > this.maxBufferSize && this.pendingBuffer.length > 0) {
        const dropped = this.pendingBuffer.shift()!;
        this.bufferSize -= dropped.length;
      }
    }
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, 8000);
  }

  private stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  close() {
    this.closed = true;
    this.stopKeepAlive();
    this.pendingBuffer = [];
    this.bufferSize = 0;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      // Send CloseStream message for graceful shutdown
      try { this.ws.send(JSON.stringify({ type: "CloseStream" })); } catch { /* ignore */ }
      this.ws.close();
    }
    this.ws = null;
  }
}

// Factory for test session Deepgram connections
function createDeepgramConnection(
  sessionId: string,
  speaker: "tester" | "agent"
): DgHandle {
  const session = sessions.get(sessionId);

  return new DgHandle("en", sessionId, speaker, (text, isFinal, _words, _startTime, _endTime) => {
    const entry: TranscriptEntry = {
      speaker,
      text,
      isFinal,
      timestamp: Date.now(),
    };

    if (session && isFinal) {
      session.transcript.push(entry);
      dbq.persistTestTranscript(sessionId, entry);
      checkScriptAdvance(session, entry);
    }

    broadcastToSession(sessionId, { type: "transcript", entry });
  });
}

// Check if transcript matches current script step keywords → auto-advance
function checkScriptAdvance(session: Session, entry: TranscriptEntry) {
  const currentStep = session.scenario.script[session.currentScriptStep];
  if (!currentStep?.expectedKeywords?.length) return;
  if (entry.speaker !== "agent") return; // advance based on agent response

  const text = entry.text.toLowerCase();
  const matched = currentStep.expectedKeywords.some((kw) =>
    text.includes(kw.toLowerCase())
  );

  if (matched && session.currentScriptStep < session.scenario.script.length - 1) {
    session.currentScriptStep++;
    broadcastToSession(session.id, {
      type: "script_advance",
      step: session.currentScriptStep,
    });
  }
}

// ════════════════════════════════════════════════════════════════════
// Express app
// ════════════════════════════════════════════════════════════════════

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// CORS for Next.js frontend
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  next();
});

// ── REST API ────────────────────────────────────────────────────────

// List all sessions
app.get("/api/sessions", async (_req, res) => {
  const rows = await dbq.listTestSessions();
  const list = rows.map((s) => ({
    id: s.id,
    scenario: { name: s.scenarioName, persona: s.persona },
    testerPhone: s.testerPhone,
    status: s.status,
    createdAt: s.createdAt?.toISOString(),
    startedAt: s.startedAt?.toISOString(),
    endedAt: s.endedAt?.toISOString(),
    recordingUrl: s.recordingUrl,
    transcriptCount: 0, // lightweight list — no join needed
  }));
  res.json(list);
});

// Get session detail
app.get("/api/sessions/:id", async (req, res) => {
  // Try in-memory first (active sessions), then DB
  const cached = sessions.get(req.params.id);
  if (cached) { res.json(cached); return; }

  const row = await dbq.getTestSessionFromDb(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  // Reconstruct session shape from DB row
  res.json({
    id: row.id,
    scenario: {
      name: row.scenarioName,
      persona: row.persona,
      agentPhone: row.agentPhone,
      script: row.scripts.map((s) => ({ id: s.stepNumber, prompt: s.prompt, expectedKeywords: s.expectedKeywords })),
    },
    testerPhone: row.testerPhone,
    status: row.status,
    conferenceName: row.conferenceName,
    transcript: row.transcripts.map((t) => ({ speaker: t.speaker, text: t.text, isFinal: t.isFinal, timestamp: Number(t.timestamp) })),
    currentScriptStep: row.currentScriptStep,
    recordingUrl: row.recordingUrl,
    createdAt: row.createdAt?.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    endedAt: row.endedAt?.toISOString(),
  });
});

// Create a new test session
app.post("/api/sessions", async (req, res) => {
  const { scenario, testerPhone } = req.body as {
    scenario: TestScenario;
    testerPhone: string;
  };

  if (!scenario?.agentPhone || !testerPhone) {
    res.status(400).json({
      error: "Need scenario (with agentPhone) and testerPhone",
    });
    return;
  }

  // Ensure script has at least one step
  if (!scenario.script?.length) {
    scenario.script = [
      { id: 1, prompt: "Follow the conversation naturally" },
    ];
  }

  const session = createSession(scenario, testerPhone);
  await dbq.persistTestSession(session);
  console.log(`[SESSION] Created: ${session.id}`);
  res.json(session);
});

// Start the call for a session
app.post("/api/sessions/:id/start", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (session.status !== "created") {
    res.status(400).json({ error: `Session is ${session.status}, not 'created'` });
    return;
  }

  session.status = "calling";
  session.startedAt = new Date().toISOString();
  broadcastToSession(session.id, { type: "status", status: "calling" });

  try {
    // Call the tester first
    const testerCall = await twilioClient.calls.create({
      to: session.testerPhone,
      from: TWILIO_PHONE_NUMBER!,
      url: `${BASE_URL}/twiml/tester/${session.id}`,
      statusCallback: `${BASE_URL}/webhooks/call-status/${session.id}/tester`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });
    session.testerCallSid = testerCall.sid;
    dbq.updateTestSession(session.id, { testerCallSid: testerCall.sid, startedAt: session.startedAt!, status: "calling" });
    console.log(`[CALL] Tester: ${testerCall.sid} → ${session.testerPhone}`);

    broadcastToSession(session.id, {
      type: "call_event",
      event: "calling",
      speaker: "tester",
    });

    // Call the agent
    const agentCall = await twilioClient.calls.create({
      to: session.scenario.agentPhone,
      from: TWILIO_PHONE_NUMBER!,
      url: `${BASE_URL}/twiml/agent/${session.id}`,
      statusCallback: `${BASE_URL}/webhooks/call-status/${session.id}/agent`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });
    session.agentCallSid = agentCall.sid;
    dbq.updateTestSession(session.id, { agentCallSid: agentCall.sid });
    console.log(`[CALL] Agent: ${agentCall.sid} → ${session.scenario.agentPhone}`);

    broadcastToSession(session.id, {
      type: "call_event",
      event: "calling",
      speaker: "agent",
    });

    res.json({
      testerCallSid: testerCall.sid,
      agentCallSid: agentCall.sid,
      conferenceName: session.conferenceName,
    });
  } catch (err: any) {
    session.status = "created";
    console.error("[CALL] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// End the call for a session
app.post("/api/sessions/:id/end", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  try {
    // End the conference by updating its status
    if (session.conferenceSid) {
      await twilioClient
        .conferences(session.conferenceSid)
        .update({ status: "completed" });
    } else {
      // Fall back to ending individual calls
      if (session.testerCallSid) {
        await twilioClient
          .calls(session.testerCallSid)
          .update({ status: "completed" });
      }
      if (session.agentCallSid) {
        await twilioClient
          .calls(session.agentCallSid)
          .update({ status: "completed" });
      }
    }

    session.status = "ended";
    session.endedAt = new Date().toISOString();
    broadcastToSession(session.id, { type: "status", status: "ended" });
    res.json({ status: "ended" });
  } catch (err: any) {
    console.error("[END] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Manually advance script step
app.post("/api/sessions/:id/advance-script", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.currentScriptStep < session.scenario.script.length - 1) {
    session.currentScriptStep++;
    broadcastToSession(session.id, {
      type: "script_advance",
      step: session.currentScriptStep,
    });
  }
  res.json({ currentStep: session.currentScriptStep });
});

// ── TwiML endpoints (Twilio fetches these when call connects) ──────

// TwiML for tester's call leg
app.all("/twiml/tester/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;
  const twiml = new VoiceResponse();

  // Fork tester's audio to our WebSocket for ASR
  const start = twiml.start();
  const stream = start.stream({
    url: `${WS_URL}/media-stream`,
    track: "inbound_track", // what the tester says into their phone
  });
  stream.parameter({ name: "sessionId", value: sessionId });
  stream.parameter({ name: "speaker", value: "tester" });

  twiml.say(
    { voice: "Polly.Amy" },
    "You are being connected to the voice agent. This call is being recorded and transcribed. Please follow the prompts on your screen."
  );

  // Join the conference
  const dial = twiml.dial();
  dial.conference(
    {
      record: "record-from-start",
      startConferenceOnEnter: true,
      endConferenceOnExit: false,
      participantLabel: "tester",
      beep: "false",
      statusCallback: `${BASE_URL}/webhooks/conference/${sessionId}`,
      statusCallbackEvent: ["start", "end", "join", "leave"],
      recordingStatusCallback: `${BASE_URL}/webhooks/recording/${sessionId}`,
      recordingStatusCallbackEvent: ["completed"],
    },
    `test-${sessionId}`
  );

  res.type("text/xml");
  res.send(twiml.toString());
});

// TwiML for agent's call leg
app.all("/twiml/agent/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;
  const twiml = new VoiceResponse();

  // Fork agent's audio to our WebSocket for ASR
  const start = twiml.start();
  const stream = start.stream({
    url: `${WS_URL}/media-stream`,
    track: "inbound_track", // what the agent says
  });
  stream.parameter({ name: "sessionId", value: sessionId });
  stream.parameter({ name: "speaker", value: "agent" });

  // Join the same conference (no announcement for agent)
  const dial = twiml.dial();
  dial.conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: true, // end when agent hangs up
      participantLabel: "agent",
      beep: "false",
    },
    `test-${sessionId}`
  );

  res.type("text/xml");
  res.send(twiml.toString());
});

// ── Webhooks ────────────────────────────────────────────────────────

// Call status updates
app.post("/webhooks/call-status/:sessionId/:role", (req, res) => {
  const { sessionId, role } = req.params;
  const { CallSid, CallStatus } = req.body;
  const session = sessions.get(sessionId);

  console.log(`[STATUS] ${role}@${sessionId}: ${CallStatus} (${CallSid})`);

  if (session) {
    broadcastToSession(sessionId, {
      type: "call_event",
      event: CallStatus,
      speaker: role,
    });

    // Both answered → session is active
    if (CallStatus === "in-progress") {
      if (session.status !== "active") {
        session.status = "active";
        dbq.updateTestSession(sessionId, { status: "active" });
        broadcastToSession(sessionId, { type: "status", status: "active" });
      }
    }

    // Either completed → session may be ending
    if (CallStatus === "completed" && session.status === "active") {
      session.status = "ended";
      session.endedAt = new Date().toISOString();
      dbq.updateTestSession(sessionId, { status: "ended", endedAt: session.endedAt });
      broadcastToSession(sessionId, { type: "status", status: "ended" });
    }
  }

  res.sendStatus(200);
});

// Conference events
app.post("/webhooks/conference/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const { ConferenceSid, StatusCallbackEvent, ParticipantLabel } = req.body;
  const session = sessions.get(sessionId);

  console.log(`[CONF] ${sessionId}: ${StatusCallbackEvent} (${ParticipantLabel ?? "n/a"})`);

  if (session && ConferenceSid) {
    session.conferenceSid = ConferenceSid;
    dbq.updateTestSession(sessionId, { conferenceSid: ConferenceSid });
  }

  res.sendStatus(200);
});

// Recording completed
app.post("/webhooks/recording/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const { RecordingSid, RecordingUrl, RecordingDuration } = req.body;
  const session = sessions.get(sessionId);

  const url = `${RecordingUrl}.mp3`;
  console.log(`[REC] ${sessionId}: ${url} (${RecordingDuration}s)`);

  if (session) {
    session.recordingSid = RecordingSid;
    session.recordingUrl = url;
    dbq.updateTestSession(sessionId, { recordingSid: RecordingSid, recordingUrl: url });
    broadcastToSession(sessionId, { type: "recording", url });
  }

  res.sendStatus(200);
});

// ════════════════════════════════════════════════════════════════════
// CAPTURE MODE — Phone-to-phone recording for ASR datasets
// ════════════════════════════════════════════════════════════════════

function createDeepgramCaptureConnection(
  captureId: string,
  speaker: "caller_a" | "caller_b",
  language: string
): DgHandle {
  const capture = captures.get(captureId);

  return new DgHandle(language, captureId, speaker, (text, isFinal, words, startTime, endTime) => {
    const entry: CaptureTranscriptEntry = {
      speaker,
      text,
      isFinal,
      timestamp: Date.now(),
    };

    if (capture && isFinal) {
      capture.transcript.push(entry);
      dbq.persistCaptureTranscript(captureId, { ...entry, startTime, endTime });

      // Persist word-level timestamps
      if (words.length > 0) {
        dbq.persistCaptureWords(captureId, words.map((w) => ({
          speaker,
          word: w.word,
          startTime: w.start,
          endTime: w.end,
          confidence: w.confidence,
        })));
      }
    }

    broadcastToSession(captureId, { type: "transcript", entry });
  });
}

// List captures
app.get("/api/captures", async (_req, res) => {
  const rows = await dbq.listCaptures();
  const list = rows.map((c) => ({
    id: c.id,
    name: c.name,
    phoneA: c.phoneA,
    phoneB: c.phoneB,
    language: c.language,
    status: c.status,
    createdAt: c.createdAt?.toISOString(),
    endedAt: c.endedAt?.toISOString(),
    recordingUrl: c.recordingUrl,
    transcriptCount: 0,
  }));
  res.json(list);
});

// Get capture detail
app.get("/api/captures/:id", async (req, res) => {
  const cached = captures.get(req.params.id);
  if (cached) { res.json(cached); return; }

  const row = await dbq.getCaptureFromDb(req.params.id);
  if (!row) { res.status(404).json({ error: "Capture not found" }); return; }
  res.json({
    id: row.id,
    name: row.name,
    phoneA: row.phoneA,
    phoneB: row.phoneB,
    language: row.language,
    status: row.status,
    conferenceName: row.conferenceName,
    transcript: row.transcripts.map((t) => ({ speaker: t.speaker, text: t.text, isFinal: t.isFinal, timestamp: Number(t.timestamp) })),
    recordingUrl: row.recordingUrl,
    createdAt: row.createdAt?.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    endedAt: row.endedAt?.toISOString(),
  });
});

// Create capture
app.post("/api/captures", async (req, res) => {
  const { name, phoneA, phoneB, language } = req.body;
  if (!phoneA || !phoneB) {
    res.status(400).json({ error: "Need phoneA and phoneB" });
    return;
  }
  const capture = createCapture(name || "Untitled capture", phoneA, phoneB, language || "en");
  await dbq.persistCapture(capture);
  console.log(`[CAPTURE] Created: ${capture.id}`);
  res.json(capture);
});

// Start capture call
app.post("/api/captures/:id/start", async (req, res) => {
  const capture = captures.get(req.params.id);
  if (!capture) { res.status(404).json({ error: "Capture not found" }); return; }
  if (capture.status !== "created") {
    res.status(400).json({ error: `Capture is ${capture.status}` }); return;
  }

  capture.status = "calling";
  capture.startedAt = new Date().toISOString();
  broadcastToSession(capture.id, { type: "status", status: "calling" });

  try {
    // Call A first
    const callA = await twilioClient.calls.create({
      to: capture.phoneA,
      from: TWILIO_PHONE_NUMBER!,
      url: `${BASE_URL}/twiml/capture-a/${capture.id}`,
      statusCallback: `${BASE_URL}/webhooks/capture-status/${capture.id}/caller_a`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });
    capture.callSidA = callA.sid;
    dbq.updateCapture(capture.id, { callSidA: callA.sid, startedAt: capture.startedAt!, status: "calling" });
    console.log(`[CAPTURE] Caller A: ${callA.sid} → ${capture.phoneA}`);

    // Small delay to avoid Twilio trial throttling on concurrent international calls
    await new Promise((r) => setTimeout(r, 2000));

    // Then call B
    const callB = await twilioClient.calls.create({
      to: capture.phoneB,
      from: TWILIO_PHONE_NUMBER!,
      url: `${BASE_URL}/twiml/capture-b/${capture.id}`,
      statusCallback: `${BASE_URL}/webhooks/capture-status/${capture.id}/caller_b`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });
    capture.callSidB = callB.sid;
    dbq.updateCapture(capture.id, { callSidB: callB.sid });
    console.log(`[CAPTURE] Caller B: ${callB.sid} → ${capture.phoneB}`);

    res.json({ callSidA: callA.sid, callSidB: callB.sid });
  } catch (err: any) {
    capture.status = "created";
    res.status(500).json({ error: err.message });
  }
});

// End capture
app.post("/api/captures/:id/end", async (req, res) => {
  const capture = captures.get(req.params.id);
  if (!capture) { res.status(404).json({ error: "Capture not found" }); return; }

  try {
    if (capture.conferenceSid) {
      await twilioClient.conferences(capture.conferenceSid).update({ status: "completed" });
    } else {
      if (capture.callSidA) await twilioClient.calls(capture.callSidA).update({ status: "completed" });
      if (capture.callSidB) await twilioClient.calls(capture.callSidB).update({ status: "completed" });
    }
    capture.status = "ended";
    capture.endedAt = new Date().toISOString();
    broadcastToSession(capture.id, { type: "status", status: "ended" });
    res.json({ status: "ended" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Export capture transcript as JSON dataset
app.get("/api/captures/:id/export", async (req, res) => {
  // Try in-memory first, then DB
  const cached = captures.get(req.params.id);
  if (cached) {
    const dataset = {
      id: cached.id, name: cached.name, language: cached.language,
      phoneA: cached.phoneA, phoneB: cached.phoneB,
      duration: cached.startedAt && cached.endedAt
        ? Math.round((new Date(cached.endedAt).getTime() - new Date(cached.startedAt).getTime()) / 1000) : null,
      recordingUrl: cached.recordingUrl,
      transcript: cached.transcript.filter((t) => t.isFinal),
      metadata: { createdAt: cached.createdAt, startedAt: cached.startedAt, endedAt: cached.endedAt,
        totalUtterances: cached.transcript.filter((t) => t.isFinal).length },
    };
    res.setHeader("Content-Disposition", `attachment; filename="capture-${cached.id}.json"`);
    res.json(dataset);
    return;
  }

  // Fall back to DB
  const row = await dbq.getCaptureFromDb(req.params.id);
  if (!row) { res.status(404).json({ error: "Capture not found" }); return; }

  const finalTranscripts = row.transcripts.filter((t) => t.isFinal);
  const dataset = {
    id: row.id, name: row.name, language: row.language,
    phoneA: row.phoneA, phoneB: row.phoneB,
    duration: row.startedAt && row.endedAt
      ? Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000) : null,
    recordingUrl: row.recordingUrl,
    transcript: finalTranscripts.map((t) => ({ speaker: t.speaker, text: t.text, isFinal: t.isFinal, timestamp: Number(t.timestamp) })),
    metadata: { createdAt: row.createdAt?.toISOString(), startedAt: row.startedAt?.toISOString(),
      endedAt: row.endedAt?.toISOString(), totalUtterances: finalTranscripts.length },
  };
  res.setHeader("Content-Disposition", `attachment; filename="capture-${row.id}.json"`);
  res.json(dataset);
});

// ── Capture TwiML endpoints ─────────────────────────────────────────

app.all("/twiml/capture-a/:captureId", (req, res) => {
  const captureId = req.params.captureId;
  const capture = captures.get(captureId);
  const twiml = new VoiceResponse();

  const start = twiml.start();
  const stream = start.stream({
    url: `${WS_URL}/media-stream`,
    track: "inbound_track",
  });
  stream.parameter({ name: "sessionId", value: captureId });
  stream.parameter({ name: "speaker", value: "caller_a" });
  stream.parameter({ name: "mode", value: "capture" });
  stream.parameter({ name: "language", value: capture?.language ?? "en" });

  twiml.say({ voice: "Polly.Amy" }, "This call is being recorded for quality and training purposes.");

  const dial = twiml.dial();
  dial.conference({
    record: "record-from-start",
    startConferenceOnEnter: true,
    endConferenceOnExit: false,
    participantLabel: "caller_a",
    beep: "false",
    statusCallback: `${BASE_URL}/webhooks/capture-conference/${captureId}`,
    statusCallbackEvent: ["start", "end", "join", "leave"],
    recordingStatusCallback: `${BASE_URL}/webhooks/capture-recording/${captureId}`,
    recordingStatusCallbackEvent: ["completed"],
  }, `cap-${captureId}`);

  res.type("text/xml");
  res.send(twiml.toString());
});

app.all("/twiml/capture-b/:captureId", (req, res) => {
  const captureId = req.params.captureId;
  const capture = captures.get(captureId);
  const twiml = new VoiceResponse();

  const start = twiml.start();
  const stream = start.stream({
    url: `${WS_URL}/media-stream`,
    track: "inbound_track",
  });
  stream.parameter({ name: "sessionId", value: captureId });
  stream.parameter({ name: "speaker", value: "caller_b" });
  stream.parameter({ name: "mode", value: "capture" });
  stream.parameter({ name: "language", value: capture?.language ?? "en" });

  twiml.say({ voice: "Polly.Amy" }, "This call is being recorded for quality and training purposes.");

  const dial = twiml.dial();
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: false,
    participantLabel: "caller_b",
    beep: "false",
    statusCallback: `${BASE_URL}/webhooks/capture-conference/${captureId}`,
    statusCallbackEvent: ["join", "leave"],
  }, `cap-${captureId}`);

  res.type("text/xml");
  res.send(twiml.toString());
});

// ── Capture webhooks ────────────────────────────────────────────────

app.post("/webhooks/capture-status/:captureId/:role", (req, res) => {
  const { captureId, role } = req.params;
  const { CallStatus } = req.body;
  const capture = captures.get(captureId);

  console.log(`[CAP-STATUS] ${role}@${captureId}: ${CallStatus}`);

  if (capture) {
    broadcastToSession(captureId, { type: "call_event", event: CallStatus, speaker: role });
    if (CallStatus === "in-progress" && capture.status !== "active") {
      capture.status = "active";
      dbq.updateCapture(captureId, { status: "active" });
      broadcastToSession(captureId, { type: "status", status: "active" });
    }
    if (CallStatus === "completed" && capture.status === "active") {
      capture.status = "ended";
      capture.endedAt = new Date().toISOString();
      dbq.updateCapture(captureId, { status: "ended", endedAt: capture.endedAt });
      broadcastToSession(captureId, { type: "status", status: "ended" });
    }
  }
  res.sendStatus(200);
});

app.post("/webhooks/capture-conference/:captureId", (req, res) => {
  const capture = captures.get(req.params.captureId);
  if (capture && req.body.ConferenceSid) {
    capture.conferenceSid = req.body.ConferenceSid;
    dbq.updateCapture(req.params.captureId, { conferenceSid: req.body.ConferenceSid });
  }
  res.sendStatus(200);
});

app.post("/webhooks/capture-recording/:captureId", (req, res) => {
  const capture = captures.get(req.params.captureId);
  const url = `${req.body.RecordingUrl}.mp3`;
  console.log(`[CAP-REC] ${req.params.captureId}: ${url}`);
  if (capture) {
    capture.recordingSid = req.body.RecordingSid;
    capture.recordingUrl = url;
    dbq.updateCapture(req.params.captureId, { recordingSid: req.body.RecordingSid, recordingUrl: url });
    broadcastToSession(req.params.captureId, { type: "recording", url });
  }
  res.sendStatus(200);
});

// ── Local audio files ────────────────────────────────────────────────

app.get("/api/audio/:captureId/:speaker", async (req, res) => {
  const { captureId, speaker } = req.params;
  const filename = `${captureId}-${speaker}.wav`;
  const { getRecordingPath, recordingExists } = await import("./audio");
  if (!recordingExists(filename)) {
    res.status(404).json({ error: "Audio file not found" });
    return;
  }
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(getRecordingPath(filename));
});

// Serve word-level timestamps for a capture
app.get("/api/captures/:id/words", async (req, res) => {
  const row = await dbq.getCaptureFromDb(req.params.id);
  if (!row) { res.status(404).json({ error: "Capture not found" }); return; }
  res.json(row.words ?? []);
});

// ── Recording proxy (Twilio requires auth to access recordings) ─────

app.get("/api/recordings/:recordingSid", async (req, res) => {
  const { recordingSid } = req.params;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.mp3`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
      },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: "Recording not found" });
      return;
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err: any) {
    console.error("[REC-PROXY] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    twilioNumber: TWILIO_PHONE_NUMBER,
    sessions: sessions.size,
    captures: captures.size,
  });
});

// ════════════════════════════════════════════════════════════════════
// HTTP + WebSocket server
// ════════════════════════════════════════════════════════════════════

const server = createServer(app);

// Media stream WebSocket — Twilio sends audio here
const mediaWss = new WebSocketServer({ noServer: true });
// Client WebSocket — frontend connects here for live updates
const clientWss = new WebSocketServer({ noServer: true });

// Route WebSocket upgrades
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);

  if (url.pathname === "/media-stream") {
    mediaWss.handleUpgrade(request, socket, head, (ws) => {
      mediaWss.emit("connection", ws, request);
    });
  } else if (url.pathname.startsWith("/ws/session/")) {
    clientWss.handleUpgrade(request, socket, head, (ws) => {
      clientWss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ── Media stream handler (Twilio → Deepgram) ───────────────────────

mediaWss.on("connection", (ws) => {
  let sessionId = "";
  let speaker: string = "tester";
  let mode: string = "test";
  let dgHandle: DgHandle | null = null;
  const audioChunks: Buffer[] = []; // buffer raw audio for local storage

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());

    switch (msg.event) {
      case "connected":
        console.log("[MEDIA] Twilio stream connected");
        break;

      case "start":
        sessionId = msg.start?.customParameters?.sessionId ?? "";
        speaker = msg.start?.customParameters?.speaker ?? "tester";
        mode = msg.start?.customParameters?.mode ?? "test";
        const language = msg.start?.customParameters?.language ?? "en";
        console.log(`[MEDIA] Stream started: ${speaker}@${sessionId} mode=${mode} (${msg.start.streamSid})`);

        if (mode === "capture") {
          dgHandle = createDeepgramCaptureConnection(sessionId, speaker as "caller_a" | "caller_b", language);
        } else {
          dgHandle = createDeepgramConnection(sessionId, speaker as "tester" | "agent");
        }
        break;

      case "media": {
        const audioBuffer = Buffer.from(msg.media.payload, "base64");

        // Buffer audio for local file storage
        if (mode === "capture") {
          audioChunks.push(audioBuffer);
        }

        // Forward to Deepgram for ASR
        dgHandle?.sendAudio(audioBuffer);
        break;
      }

      case "stop":
        console.log(`[MEDIA] Stream stopped: ${speaker}@${sessionId}`);
        dgHandle?.close();

        // Write buffered audio to local WAV file
        if (mode === "capture" && audioChunks.length > 0) {
          const filename = `${sessionId}-${speaker}.wav`;
          const filePath = writeMulawWav(filename, audioChunks);
          const pathField = speaker === "caller_a" ? "localAudioPathA" : "localAudioPathB";
          dbq.updateCapture(sessionId, { [pathField]: filePath } as any);
          console.log(`[AUDIO] Saved ${speaker}@${sessionId} → ${filename}`);
        }
        break;
    }
  });

  ws.on("close", () => {
    dgHandle?.close();
  });
});

// ── Client WebSocket handler (frontend connects here) ──────────────

clientWss.on("connection", (ws, request) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  const sessionId = url.pathname.replace("/ws/session/", "");

  // Support both test sessions and captures
  const session = sessions.get(sessionId);
  const capture = captures.get(sessionId);
  if (!session && !capture) {
    ws.close(4004, "Session not found");
    return;
  }

  if (!clientSockets.has(sessionId)) {
    clientSockets.set(sessionId, new Set());
  }
  clientSockets.get(sessionId)!.add(ws);
  console.log(`[WS] Client connected to ${session ? "session" : "capture"} ${sessionId}`);

  const target = session ?? capture!;
  ws.send(JSON.stringify({ type: "status", status: target.status }));

  for (const entry of target.transcript) {
    ws.send(JSON.stringify({ type: "transcript", entry }));
  }

  ws.on("close", () => {
    clientSockets.get(sessionId)?.delete(ws);
    console.log(`[WS] Client disconnected from session ${sessionId}`);
  });
});

// ════════════════════════════════════════════════════════════════════
// Start
// ════════════════════════════════════════════════════════════════════

server.listen(Number(PORT), () => {
  console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║   Voice Agent Testing Platform — Backend             ║
  ╠══════════════════════════════════════════════════════╣
  ║   HTTP:  http://localhost:${PORT}                      ║
  ║   WS:    ws://localhost:${PORT}/ws/session/:id         ║
  ║   Base:  ${BASE_URL}               ║
  ║   Phone: ${TWILIO_PHONE_NUMBER}                        ║
  ╚══════════════════════════════════════════════════════╝

  API Endpoints:
    GET  /api/sessions           — list sessions
    POST /api/sessions           — create session
    GET  /api/sessions/:id       — session detail
    POST /api/sessions/:id/start — start the call
    POST /api/sessions/:id/end   — end the call
    POST /api/sessions/:id/advance-script — next prompt
    GET  /health                 — health check

  WebSocket:
    /ws/session/:id              — live transcript stream
    /media-stream                — Twilio media (internal)
  `);
});
