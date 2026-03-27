import { eq } from "drizzle-orm";
import { db } from "./index";
import * as schema from "./schema";
import type { Session, Capture, TranscriptEntry, CaptureTranscriptEntry, ScriptStep } from "../types";

// ── Test Sessions ───────────────────────────────────────────────────

export async function persistTestSession(session: Session) {
  await db
    .insert(schema.testSessions)
    .values({
      id: session.id,
      scenarioName: session.scenario.name,
      persona: session.scenario.persona,
      agentPhone: session.scenario.agentPhone,
      testerPhone: session.testerPhone,
      status: session.status,
      conferenceName: session.conferenceName,
      currentScriptStep: session.currentScriptStep,
      createdAt: new Date(session.createdAt),
    })
    .onConflictDoNothing();

  // Insert script steps
  if (session.scenario.script.length > 0) {
    await db
      .insert(schema.testScripts)
      .values(
        session.scenario.script.map((step) => ({
          sessionId: session.id,
          stepNumber: step.id,
          prompt: step.prompt,
          expectedKeywords: step.expectedKeywords ?? null,
        }))
      )
      .onConflictDoNothing();
  }
}

export async function updateTestSession(
  id: string,
  fields: Partial<{
    status: string;
    testerCallSid: string;
    agentCallSid: string;
    conferenceSid: string;
    currentScriptStep: number;
    recordingUrl: string;
    recordingSid: string;
    startedAt: string;
    endedAt: string;
  }>
) {
  const update: Record<string, unknown> = {};
  if (fields.status !== undefined) update.status = fields.status;
  if (fields.testerCallSid !== undefined) update.testerCallSid = fields.testerCallSid;
  if (fields.agentCallSid !== undefined) update.agentCallSid = fields.agentCallSid;
  if (fields.conferenceSid !== undefined) update.conferenceSid = fields.conferenceSid;
  if (fields.currentScriptStep !== undefined) update.currentScriptStep = fields.currentScriptStep;
  if (fields.recordingUrl !== undefined) update.recordingUrl = fields.recordingUrl;
  if (fields.recordingSid !== undefined) update.recordingSid = fields.recordingSid;
  if (fields.startedAt !== undefined) update.startedAt = new Date(fields.startedAt);
  if (fields.endedAt !== undefined) update.endedAt = new Date(fields.endedAt);

  if (Object.keys(update).length > 0) {
    await db.update(schema.testSessions).set(update).where(eq(schema.testSessions.id, id));
  }
}

export async function persistTestTranscript(sessionId: string, entry: TranscriptEntry) {
  await db.insert(schema.testTranscripts).values({
    sessionId,
    speaker: entry.speaker,
    text: entry.text,
    isFinal: entry.isFinal,
    timestamp: entry.timestamp,
  });
}

export async function getTestSessionFromDb(id: string) {
  return db.query.testSessions.findFirst({
    where: eq(schema.testSessions.id, id),
    with: { scripts: true, transcripts: true },
  });
}

export async function listTestSessions() {
  return db.query.testSessions.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}

// ── Captures ────────────────────────────────────────────────────────

export async function persistCapture(capture: Capture) {
  await db
    .insert(schema.captures)
    .values({
      id: capture.id,
      name: capture.name,
      phoneA: capture.phoneA,
      phoneB: capture.phoneB,
      language: capture.language,
      status: capture.status,
      conferenceName: capture.conferenceName,
      createdAt: new Date(capture.createdAt),
    })
    .onConflictDoNothing();
}

export async function updateCapture(
  id: string,
  fields: Partial<{
    status: string;
    callSidA: string;
    callSidB: string;
    conferenceSid: string;
    recordingUrl: string;
    recordingSid: string;
    localAudioPath: string;
    localAudioPathA: string;
    localAudioPathB: string;
    startedAt: string;
    endedAt: string;
  }>
) {
  const update: Record<string, unknown> = {};
  if (fields.status !== undefined) update.status = fields.status;
  if (fields.callSidA !== undefined) update.callSidA = fields.callSidA;
  if (fields.callSidB !== undefined) update.callSidB = fields.callSidB;
  if (fields.conferenceSid !== undefined) update.conferenceSid = fields.conferenceSid;
  if (fields.recordingUrl !== undefined) update.recordingUrl = fields.recordingUrl;
  if (fields.recordingSid !== undefined) update.recordingSid = fields.recordingSid;
  if (fields.localAudioPath !== undefined) update.localAudioPath = fields.localAudioPath;
  if (fields.localAudioPathA !== undefined) update.localAudioPathA = fields.localAudioPathA;
  if (fields.localAudioPathB !== undefined) update.localAudioPathB = fields.localAudioPathB;
  if (fields.startedAt !== undefined) update.startedAt = new Date(fields.startedAt);
  if (fields.endedAt !== undefined) update.endedAt = new Date(fields.endedAt);

  if (Object.keys(update).length > 0) {
    await db.update(schema.captures).set(update).where(eq(schema.captures.id, id));
  }
}

export interface CaptureTranscriptWithTimes extends CaptureTranscriptEntry {
  startTime?: number;
  endTime?: number;
}

export async function persistCaptureTranscript(captureId: string, entry: CaptureTranscriptWithTimes) {
  await db.insert(schema.captureTranscripts).values({
    captureId,
    speaker: entry.speaker,
    text: entry.text,
    isFinal: entry.isFinal,
    timestamp: entry.timestamp,
    startTime: entry.startTime ?? null,
    endTime: entry.endTime ?? null,
  });
}

export interface WordTimestamp {
  speaker: string;
  word: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

export async function persistCaptureWords(captureId: string, words: WordTimestamp[]) {
  if (words.length === 0) return;
  await db.insert(schema.captureWords).values(
    words.map((w) => ({
      captureId,
      speaker: w.speaker,
      word: w.word,
      startTime: w.startTime,
      endTime: w.endTime,
      confidence: w.confidence,
    }))
  );
}

export async function getCaptureFromDb(id: string) {
  return db.query.captures.findFirst({
    where: eq(schema.captures.id, id),
    with: { transcripts: true, words: true },
  });
}

export async function listCaptures() {
  return db.query.captures.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}
