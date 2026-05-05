import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

// Resolve the migrations folder. We support two layouts:
//
//   1. Compiled binary (production): the binary lives at
//      ~/.local/share/voxpilot/voxpilot with a sibling `drizzle/` directory.
//      `import.meta.dir` points to the embedded $bunfs path after --compile,
//      so we use process.execPath to find files next to the binary on disk.
//
//   2. Source layout (development): db.ts lives at backend/src/db.ts; the
//      drizzle folder is at backend/drizzle (i.e. ../drizzle from import.meta.dir).
//
// Try the bundled layout first, fall back to the source layout.
const migrationsFolder = (() => {
  const beside = resolve(dirname(process.execPath), "drizzle");
  if (existsSync(beside)) return beside;
  return resolve(import.meta.dir, "../drizzle");
})();

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
