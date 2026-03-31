import { eq, and, gt, desc } from "drizzle-orm";
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

export async function listCapturesByUser(userId: string) {
  return db
    .select()
    .from(schema.captures)
    .where(eq(schema.captures.userId, userId))
    .orderBy(desc(schema.captures.createdAt));
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
