import {
  pgTable,
  text,
  varchar,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const captures = pgTable("captures_v2", {
  id: varchar("id", { length: 12 }).primaryKey(),
  name: text("name").notNull(),
  phoneA: varchar("phone_a", { length: 20 }).notNull(),
  phoneB: varchar("phone_b", { length: 20 }).notNull(),
  language: varchar("language", { length: 10 }).notNull().default("en"),
  status: varchar("status", { length: 20 }).notNull().default("created"),
  roomName: varchar("room_name", { length: 100 }),
  egressId: varchar("egress_id", { length: 50 }),
  recordingUrl: text("recording_url"),
  localRecordingPath: text("local_recording_path"),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});
