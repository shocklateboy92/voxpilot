import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function initDb(path = "voxpilot.db") {
  const sqlite = new Database(path);
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

export function closeDb() {
  db = undefined;
}
