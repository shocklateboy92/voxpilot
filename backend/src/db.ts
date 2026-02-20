import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function initDb(path = "voxpilot.db") {
  const sqlite = new Database(path);
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");

  const d = drizzle(sqlite, { schema });
  migrate(d, { migrationsFolder });

  db = d;
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

export function closeDb() {
  db = undefined;
}
