import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";

/**
 * Run pending Drizzle migrations against the database.
 * Called once on API server startup — safe to run multiple times
 * (Drizzle tracks applied migrations in a __drizzle_migrations table).
 *
 * In production (ECS), the migration files are bundled into the Docker image.
 * Locally, they're in the drizzle/ directory at the repo root.
 */
export async function runMigrations() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set — cannot run migrations");

  // Use a separate connection for migrations (not the pool)
  const migrationClient = postgres(url, { max: 1 });
  const db = drizzle(migrationClient);

  // Resolve migration folder — works in both local dev and Docker
  // Local: repo-root/drizzle/
  // Docker: /app/drizzle/ (copied in Dockerfile)
  const migrationsFolder = process.env.MIGRATIONS_DIR
    || path.resolve(process.cwd(), "drizzle");

  console.log(`[MIGRATE] Running migrations from ${migrationsFolder}`);

  await migrate(db, { migrationsFolder });

  console.log("[MIGRATE] Migrations complete");

  // Close the migration-only connection
  await migrationClient.end();
}
