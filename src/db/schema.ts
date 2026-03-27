import {
  pgTable,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  bigint,
  jsonb,
  real,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Test Sessions (Agent Testing Mode) ──────────────────────────────

export const testSessions = pgTable("test_sessions", {
  id: varchar("id", { length: 12 }).primaryKey(),
  scenarioName: text("scenario_name").notNull(),
  persona: text("persona").notNull().default(""),
  agentPhone: varchar("agent_phone", { length: 20 }).notNull(),
  testerPhone: varchar("tester_phone", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("created"),
  conferenceName: varchar("conference_name", { length: 50 }).notNull(),
  testerCallSid: varchar("tester_call_sid", { length: 40 }),
  agentCallSid: varchar("agent_call_sid", { length: 40 }),
  conferenceSid: varchar("conference_sid", { length: 40 }),
  currentScriptStep: integer("current_script_step").notNull().default(0),
  recordingUrl: text("recording_url"),
  recordingSid: varchar("recording_sid", { length: 40 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const testSessionsRelations = relations(testSessions, ({ many }) => ({
  scripts: many(testScripts),
  transcripts: many(testTranscripts),
}));

// ── Test Scripts (prompt steps for the tester) ──────────────────────

export const testScripts = pgTable("test_scripts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sessionId: varchar("session_id", { length: 12 })
    .notNull()
    .references(() => testSessions.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  prompt: text("prompt").notNull(),
  expectedKeywords: jsonb("expected_keywords").$type<string[]>(),
});

export const testScriptsRelations = relations(testScripts, ({ one }) => ({
  session: one(testSessions, {
    fields: [testScripts.sessionId],
    references: [testSessions.id],
  }),
}));

// ── Test Transcripts ────────────────────────────────────────────────

export const testTranscripts = pgTable("test_transcripts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sessionId: varchar("session_id", { length: 12 })
    .notNull()
    .references(() => testSessions.id, { onDelete: "cascade" }),
  speaker: varchar("speaker", { length: 10 }).notNull(),
  text: text("text").notNull(),
  isFinal: boolean("is_final").notNull().default(true),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
});

export const testTranscriptsRelations = relations(testTranscripts, ({ one }) => ({
  session: one(testSessions, {
    fields: [testTranscripts.sessionId],
    references: [testSessions.id],
  }),
}));

// ── Captures (Phone-to-Phone ASR Data Collection) ──────────────────

export const captures = pgTable("captures", {
  id: varchar("id", { length: 12 }).primaryKey(),
  name: text("name").notNull(),
  phoneA: varchar("phone_a", { length: 20 }).notNull(),
  phoneB: varchar("phone_b", { length: 20 }).notNull(),
  language: varchar("language", { length: 10 }).notNull().default("en"),
  status: varchar("status", { length: 20 }).notNull().default("created"),
  conferenceName: varchar("conference_name", { length: 50 }).notNull(),
  callSidA: varchar("call_sid_a", { length: 40 }),
  callSidB: varchar("call_sid_b", { length: 40 }),
  conferenceSid: varchar("conference_sid", { length: 40 }),
  recordingUrl: text("recording_url"),
  recordingSid: varchar("recording_sid", { length: 40 }),
  localAudioPath: text("local_audio_path"),       // path to locally stored mixed .wav
  localAudioPathA: text("local_audio_path_a"),     // caller A's audio
  localAudioPathB: text("local_audio_path_b"),     // caller B's audio
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const capturesRelations = relations(captures, ({ many }) => ({
  transcripts: many(captureTranscripts),
  words: many(captureWords),
}));

// ── Capture Transcripts (utterance-level) ───────────────────────────

export const captureTranscripts = pgTable("capture_transcripts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  captureId: varchar("capture_id", { length: 12 })
    .notNull()
    .references(() => captures.id, { onDelete: "cascade" }),
  speaker: varchar("speaker", { length: 10 }).notNull(),
  text: text("text").notNull(),
  isFinal: boolean("is_final").notNull().default(true),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  startTime: real("start_time"),   // seconds from stream start (from Deepgram)
  endTime: real("end_time"),       // seconds from stream start (from Deepgram)
});

export const captureTranscriptsRelations = relations(captureTranscripts, ({ one }) => ({
  capture: one(captures, {
    fields: [captureTranscripts.captureId],
    references: [captures.id],
  }),
}));

// ── Capture Words (word-level timestamps for scrubbing) ─────────────

export const captureWords = pgTable("capture_words", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  captureId: varchar("capture_id", { length: 12 })
    .notNull()
    .references(() => captures.id, { onDelete: "cascade" }),
  speaker: varchar("speaker", { length: 10 }).notNull(),
  word: text("word").notNull(),
  startTime: real("start_time").notNull(),  // seconds from stream start
  endTime: real("end_time").notNull(),
  confidence: real("confidence").notNull(),
});

export const captureWordsRelations = relations(captureWords, ({ one }) => ({
  capture: one(captures, {
    fields: [captureWords.captureId],
    references: [captures.id],
  }),
}));
