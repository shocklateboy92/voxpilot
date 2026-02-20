import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { config } from "./config";
import * as schema from "./schema";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function openDb(path: string) {
  const sqlite = new Database(path);
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");

  const d = drizzle(sqlite, { schema });
  migrate(d, { migrationsFolder });

  db = d;
  return db;
}

/**
 * Override the database path (e.g. `:memory:` for tests).
 * In production, prefer {@link getDb} which lazy-initializes from config.
 */
export function initDb(path: string) {
  return openDb(path);
}

/** Returns the Drizzle instance, initializing from config on first call. */
export function getDb() {
  if (!db) openDb(config.dbPath);
  return db as NonNullable<typeof db>;
}

export function closeDb() {
  db = undefined;
}
