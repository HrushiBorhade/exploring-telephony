import crypto from "crypto";
import { eq, and, gt, gte, desc, sql, inArray, count, sum } from "drizzle-orm";
import { db } from "./index";
import * as schema from "./schema";

export async function createCapture(data: typeof schema.captures.$inferInsert) {
  await db.insert(schema.captures).values(data).onConflictDoNothing();
}

export async function updateCapture(id: string, fields: Partial<typeof schema.captures.$inferInsert>) {
  await db.update(schema.captures).set(fields).where(eq(schema.captures.id, id));
}

export async function getCapture(id: string) {
  return db.query.captures.findFirst({ where: eq(schema.captures.id, id) });
}

export async function findCaptureByEgressId(egressId: string) {
  if (!egressId) return undefined;
  return db.query.captures.findFirst({ where: eq(schema.captures.egressId, egressId) });
}

export async function listCapturesByUser(
  userId: string,
  opts?: { cursor?: string; limit?: number },
) {
  const limit = opts?.limit ?? 20;
  const conditions = [eq(schema.captures.userId, userId)];

  if (opts?.cursor) {
    // cursor is a createdAt ISO string — fetch rows older than cursor
    conditions.push(sql`${schema.captures.createdAt} < ${opts.cursor}`);
  }

  return db
    .select()
    .from(schema.captures)
    .where(and(...conditions))
    .orderBy(desc(schema.captures.createdAt))
    .limit(limit + 1); // fetch one extra to determine hasMore
}

export async function getCaptureStats(userId: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totals] = await db
    .select({
      total: count(),
      completed: count(sql`CASE WHEN ${schema.captures.status} = 'completed' THEN 1 END`),
      totalDuration: sum(schema.captures.durationSeconds),
    })
    .from(schema.captures)
    .where(eq(schema.captures.userId, userId));

  // Separate query for verified stats — avoids CASE+SUM column interpolation issues
  const [verified] = await db
    .select({
      verifiedCount: count(),
      verifiedDuration: sql<number>`COALESCE(SUM(${schema.captures.durationSeconds}), 0)`,
    })
    .from(schema.captures)
    .where(
      and(
        eq(schema.captures.userId, userId),
        eq(schema.captures.verified, true),
      )
    );

  const [weekly] = await db
    .select({ thisWeek: count() })
    .from(schema.captures)
    .where(
      and(
        eq(schema.captures.userId, userId),
        gte(schema.captures.createdAt, sevenDaysAgo),
      )
    );

  return {
    total: totals?.total ?? 0,
    completed: Number(totals?.completed ?? 0),
    totalDuration: Number(totals?.totalDuration ?? 0),
    verifiedCount: Number(verified?.verifiedCount ?? 0),
    verifiedDuration: Number(verified?.verifiedDuration ?? 0),
    thisWeek: weekly?.thisWeek ?? 0,
  };
}

export async function findCaptureByRoomName(roomName: string) {
  if (!roomName) return undefined;
  return db.query.captures.findFirst({ where: eq(schema.captures.roomName, roomName) });
}

export async function ping() {
  await db.execute(sql`SELECT 1`);
}

// ── Admin queries ──────────────────────────────────────────────────

export async function getAdminStats() {
  const [totals] = await db
    .select({
      total: count(),
      completed: count(sql`CASE WHEN ${schema.captures.status} = 'completed' THEN 1 END`),
      pendingReview: count(sql`CASE WHEN ${schema.captures.status} = 'completed' AND ${schema.captures.verified} = false THEN 1 END`),
      verified: count(sql`CASE WHEN ${schema.captures.verified} = true THEN 1 END`),
      totalDuration: sum(schema.captures.durationSeconds),
    })
    .from(schema.captures);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [weekly] = await db
    .select({ thisWeek: count() })
    .from(schema.captures)
    .where(gte(schema.captures.createdAt, sevenDaysAgo));

  const [users] = await db
    .select({ totalUsers: count() })
    .from(schema.user);

  return {
    totalUsers: users?.totalUsers ?? 0,
    totalCaptures: totals?.total ?? 0,
    completedCaptures: Number(totals?.completed ?? 0),
    pendingReview: Number(totals?.pendingReview ?? 0),
    verified: Number(totals?.verified ?? 0),
    totalDuration: Number(totals?.totalDuration ?? 0),
    thisWeek: weekly?.thisWeek ?? 0,
  };
}

export async function listAllCaptures(opts?: { cursor?: string; limit?: number }) {
  const limit = opts?.limit ?? 20;
  const conditions = [];

  if (opts?.cursor) {
    conditions.push(sql`${schema.captures.createdAt} < ${opts.cursor}`);
  }

  return db
    .select()
    .from(schema.captures)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.captures.createdAt))
    .limit(limit + 1);
}

export async function findStaleCaptures() {
  return db
    .select()
    .from(schema.captures)
    .where(inArray(schema.captures.status, ["calling", "active"]));
}

/**
 * Atomically set a recording URL and check if all 3 recordings are present.
 * Uses a CTE to UPDATE + check in a single SQL statement, eliminating the
 * TOCTOU race where concurrent webhooks could each see a partially-filled row.
 * Returns the row ONLY if this update caused all 3 to become non-null
 * AND status is still "ended" or "active" (prevents duplicate enqueue).
 */
export async function setRecordingUrlAndCheckReady(
  id: string,
  field: "recordingUrl" | "recordingUrlA" | "recordingUrlB",
  url: string,
  extraFields?: Partial<typeof schema.captures.$inferInsert>,
) {
  const columnMap: Record<string, string> = {
    recordingUrl: "recording_url",
    recordingUrlA: "recording_url_a",
    recordingUrlB: "recording_url_b",
  };
  const column = columnMap[field];

  // Build extra SET fragments
  const extraSetParts: any[] = [];
  if (extraFields?.durationSeconds !== undefined) {
    extraSetParts.push(sql`, duration_seconds = ${extraFields.durationSeconds}`);
  }
  if (extraFields?.endedAt !== undefined) {
    extraSetParts.push(sql`, ended_at = ${extraFields.endedAt}`);
  }

  const extraSql = extraSetParts.length > 0
    ? sql.join(extraSetParts, sql``)
    : sql``;

  // Single atomic CTE: UPDATE then check all 3 URLs in one statement
  const rows = await db.execute(sql`
    WITH updated AS (
      UPDATE captures_v2
      SET ${sql.raw(column)} = ${url} ${extraSql}
      WHERE id = ${id}
      RETURNING *
    )
    SELECT * FROM updated
    WHERE recording_url IS NOT NULL
      AND recording_url_a IS NOT NULL
      AND recording_url_b IS NOT NULL
      AND status IN ('ended', 'active')
  `);

  const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as Record<string, any>) : null;
  if (!row) return null;

  // Map snake_case columns from raw SQL to camelCase for callers
  return {
    id: row.id,
    userId: row.user_id,
    roomName: row.room_name,
    egressId: row.egress_id,
    recordingUrl: row.recording_url,
    recordingUrlA: row.recording_url_a,
    recordingUrlB: row.recording_url_b,
    status: row.status,
    durationSeconds: row.duration_seconds,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    verified: row.verified,
  };
}

export async function getSessionByToken(token: string) {
  const [row] = await db
    .select({
      userId: schema.session.userId,
      phoneNumber: schema.user.phoneNumber,
      role: schema.user.role,
      expiresAt: schema.session.expiresAt,
    })
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.session.userId, schema.user.id))
    .where(
      and(
        eq(schema.session.token, token),
        gt(schema.session.expiresAt, new Date())
      )
    )
    .limit(1);
  return row ?? null;
}

// Profile queries

export async function getProfile(userId: string) {
  return db.query.userProfiles.findFirst({
    where: eq(schema.userProfiles.id, userId),
  });
}

export async function upsertProfile(
  userId: string,
  data: { name: string; age: number; gender: string; city: string; state: string; upiId?: string },
) {
  await db
    .insert(schema.userProfiles)
    .values({ id: userId, ...data })
    .onConflictDoUpdate({
      target: schema.userProfiles.id,
      set: { ...data, updatedAt: new Date() },
    });
}

export async function markOnboardingComplete(userId: string) {
  await db
    .update(schema.userProfiles)
    .set({ onboardingCompleted: true, updatedAt: new Date() })
    .where(eq(schema.userProfiles.id, userId));
}

export async function isOnboarded(userId: string): Promise<boolean> {
  const profile = await db.query.userProfiles.findFirst({
    where: and(
      eq(schema.userProfiles.id, userId),
      eq(schema.userProfiles.onboardingCompleted, true),
    ),
    columns: { id: true },
  });
  return !!profile;
}

// Language queries

export async function getLanguages(userId: string) {
  return db
    .select()
    .from(schema.userLanguages)
    .where(eq(schema.userLanguages.userId, userId))
    .orderBy(desc(schema.userLanguages.isPrimary));
}

export async function setLanguages(
  userId: string,
  languages: { languageCode: string; languageName: string; isPrimary: boolean; dialects: string[] }[],
) {
  await db.transaction(async (tx) => {
    await tx.delete(schema.userLanguages).where(eq(schema.userLanguages.userId, userId));
    if (languages.length > 0) {
      await tx.insert(schema.userLanguages).values(
        languages.map((l) => ({ userId, ...l })),
      );
    }
  });
}

// ── Theme Sample queries ──────────────────────────────────────────────

/**
 * Atomically assign a random available theme sample to a capture.
 * Uses FOR UPDATE SKIP LOCKED to prevent race conditions.
 */
export async function assignThemeSample(
  captureId: string,
  languages: string[],
) {
  if (languages.length === 0) return null;

  const token = crypto.randomBytes(16).toString("hex");

  const rows = await db.execute(sql`
    UPDATE theme_samples
    SET status = 'assigned',
        assigned_capture_id = ${captureId},
        assigned_at = NOW(),
        public_token = ${token}
    WHERE id = (
      SELECT id FROM theme_samples
      WHERE status = 'available'
        AND language IN (${sql.join(languages.map(l => sql`${l}`), sql`, `)})
      ORDER BY RANDOM()
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function getThemeSampleByToken(token: string) {
  return db.query.themeSamples.findFirst({
    where: eq(schema.themeSamples.publicToken, token),
  });
}

export async function getThemeSampleByCaptureId(captureId: string) {
  return db.query.themeSamples.findFirst({
    where: eq(schema.themeSamples.assignedCaptureId, captureId),
  });
}

export async function releaseThemeSample(captureId: string) {
  await db
    .update(schema.themeSamples)
    .set({ status: "available", assignedCaptureId: null, assignedAt: null, publicToken: null })
    .where(eq(schema.themeSamples.assignedCaptureId, captureId));
}

export async function completeThemeSample(captureId: string) {
  await db
    .update(schema.themeSamples)
    .set({ status: "completed" })
    .where(eq(schema.themeSamples.assignedCaptureId, captureId));
}

export async function getThemeSampleAvailability() {
  return db
    .select({
      language: schema.themeSamples.language,
      available: count(sql`CASE WHEN ${schema.themeSamples.status} = 'available' THEN 1 END`),
      total: count(),
    })
    .from(schema.themeSamples)
    .groupBy(schema.themeSamples.language);
}

/**
 * List all theme samples (for admin). Returns id, category, language, status,
 * assignedCaptureId — but NOT the full data blob (too large for listing).
 */
export async function listAllThemeSamples() {
  return db
    .select({
      id: schema.themeSamples.id,
      category: schema.themeSamples.category,
      language: schema.themeSamples.language,
      status: schema.themeSamples.status,
      data: schema.themeSamples.data,
      assignedCaptureId: schema.themeSamples.assignedCaptureId,
      assignedAt: schema.themeSamples.assignedAt,
    })
    .from(schema.themeSamples)
    .orderBy(schema.themeSamples.language, schema.themeSamples.category, schema.themeSamples.id);
}

