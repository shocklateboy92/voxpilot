import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Returns the Drizzle instance, initializing on first call.
 *
 * The database path is read from `VOXPILOT_DB_PATH` (default `voxpilot.db`).
 * Tests can override by setting the env var and calling {@link closeDb} between
 * runs so the next `getDb()` re-opens with the new path.
 */
export function getDb() {
  if (!db) {
    const path = process.env["VOXPILOT_DB_PATH"] ?? "voxpilot.db";
    const sqlite = new Database(path);
    sqlite.run("PRAGMA journal_mode = WAL");
    sqlite.run("PRAGMA foreign_keys = ON");

    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
  }
  return db;
}

/** Tears down the current connection so the next {@link getDb} re-initializes. */
export function closeDb() {
  db = undefined;
}
