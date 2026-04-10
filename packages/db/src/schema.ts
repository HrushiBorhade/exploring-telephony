import {
  pgTable,
  text,
  boolean,
  timestamp,
  varchar,
  integer,
  serial,
  index,
} from "drizzle-orm/pg-core";

// ── Better Auth tables ────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  phoneNumber: text("phone_number").unique(),
  phoneNumberVerified: boolean("phone_number_verified").default(false),
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
}, (t) => [
  index("session_user_id_idx").on(t.userId),
]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Captures ──────────────────────────────────────────────────────────

export const captures = pgTable("captures_v2", {
  id: varchar("id", { length: 12 }).primaryKey(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  phoneA: varchar("phone_a", { length: 20 }).notNull(),
  phoneB: varchar("phone_b", { length: 20 }).notNull(),
  language: varchar("language", { length: 10 }).notNull().default("en"),
  status: varchar("status", { length: 20 }).notNull().default("created"),
  roomName: varchar("room_name", { length: 100 }),
  egressId: varchar("egress_id", { length: 50 }),
  recordingUrl: text("recording_url"),
  recordingUrlA: text("recording_url_a"),
  recordingUrlB: text("recording_url_b"),
  localRecordingPath: text("local_recording_path"),
  transcriptA: text("transcript_a"),
  transcriptB: text("transcript_b"),
  datasetCsvUrl: text("dataset_csv_url"),
  verified: boolean("verified"),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (t) => [
  index("captures_user_id_idx").on(t.userId),
  index("captures_egress_id_idx").on(t.egressId),
  index("captures_room_name_idx").on(t.roomName),
]);

// ── Onboarding ────────────────────────────────────────────────────────

export const userProfiles = pgTable("user_profiles", {
  id: text("id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  age: integer("age").notNull(),
  gender: text("gender").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userLanguages = pgTable("user_languages", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  languageCode: text("language_code").notNull(),
  languageName: text("language_name").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  dialects: text("dialects").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("user_languages_user_id_idx").on(t.userId),
]);
