import { eq } from "drizzle-orm";
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
  return db.query.captures.findFirst({ where: eq(schema.captures.egressId, egressId) });
}
