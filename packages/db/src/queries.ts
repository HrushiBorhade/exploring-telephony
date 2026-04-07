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

export async function listCaptures() {
  return db.query.captures.findMany({ orderBy: (t, { desc }) => [desc(t.createdAt)] });
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

export async function findStaleCaptures() {
  return db
    .select()
    .from(schema.captures)
    .where(inArray(schema.captures.status, ["calling", "active"]));
}

/**
 * Atomically set a recording URL and check if all 3 recordings are present.
 * Returns the row ONLY if this update caused all 3 to become non-null.
 * This prevents the race condition where 3 simultaneous egress_ended webhooks
 * could each read a partially-filled row.
 */
export async function setRecordingUrlAndCheckReady(
  id: string,
  field: "recordingUrl" | "recordingUrlA" | "recordingUrlB",
  url: string,
  extraFields?: Partial<typeof schema.captures.$inferInsert>,
) {
  const updates: Record<string, any> = { [field]: url, ...extraFields };

  await db.update(schema.captures).set(updates).where(eq(schema.captures.id, id));

  // Atomic check: only return the row if ALL 3 recording URLs are now present
  const [row] = await db
    .select()
    .from(schema.captures)
    .where(
      and(
        eq(schema.captures.id, id),
        sql`${schema.captures.recordingUrl} IS NOT NULL`,
        sql`${schema.captures.recordingUrlA} IS NOT NULL`,
        sql`${schema.captures.recordingUrlB} IS NOT NULL`,
        // Only trigger if we haven't already enqueued (status is still "ended")
        eq(schema.captures.status, "ended"),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function getSessionByToken(token: string) {
  const [row] = await db
    .select({
      userId: schema.session.userId,
      phoneNumber: schema.user.phoneNumber,
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
