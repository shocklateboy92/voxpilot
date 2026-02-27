import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!db) {
    const path = process.env.VOXPILOT_DB_PATH ?? "voxpilot.db";
    const sqlite = new Database(path);
    sqlite.run("PRAGMA journal_mode = WAL");
    sqlite.run("PRAGMA foreign_keys = ON");
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
  }
  return db;
}

export function closeDb() {
  db = undefined;
}
