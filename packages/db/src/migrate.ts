import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";

// Stable advisory lock ID — all API containers use the same lock
// so only one runs migrations at a time. Number is arbitrary but fixed.
const MIGRATION_LOCK_ID = 839741625;

/**
 * Run pending Drizzle migrations against the database.
 * Called once on API server startup — safe to run multiple times
 * (Drizzle tracks applied migrations in a __drizzle_migrations table).
 *
 * Uses a PostgreSQL advisory lock to prevent concurrent migration runs
 * when multiple ECS tasks start simultaneously during a rolling deploy.
 *
 * In production (ECS), the migration files are bundled into the Docker image.
 * Locally, they're in the drizzle/ directory at the repo root.
 */
export async function runMigrations(databaseUrl?: string) {
  const url = databaseUrl || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set — cannot run migrations");

  const isProduction = process.env.NODE_ENV === "production";
  console.log(`[MIGRATE] Connecting to: ${url.replace(/\/\/.*@/, "//***@")} (ssl: ${isProduction})`);
  const migrationClient = postgres(url, { max: 1, ssl: isProduction ? "require" : false });
  const db = drizzle(migrationClient);

  // In Docker: /app/drizzle (cwd is /app)
  // In local dev: cwd is apps/api, so walk up to repo root
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, "drizzle"),
    path.resolve(cwd, "../../drizzle"),
  ];
  const migrationsFolder = process.env.MIGRATIONS_DIR
    || candidates.find((p) => require("fs").existsSync(path.join(p, "meta/_journal.json")))
    || candidates[0];

  console.log(`[MIGRATE] Running migrations from ${migrationsFolder}`);

  // Acquire advisory lock — blocks if another container is already migrating.
  // pg_advisory_lock is session-level and released when the connection closes.
  await migrationClient`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;

  try {
    await migrate(db, { migrationsFolder, migrationsSchema: "public" });
    console.log("[MIGRATE] Migrations complete");
  } finally {
    await migrationClient`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
    await migrationClient.end();
  }
}
