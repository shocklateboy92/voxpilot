import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function initDb(path = "voxpilot.db") {
  const sqlite = new Database(path);
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT NOT NULL PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  sqlite.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    tool_call_id TEXT,
    artifact_id TEXT,
    created_at TEXT NOT NULL
  )`);
  sqlite.run(
    `CREATE INDEX IF NOT EXISTS ix_messages_session ON messages(session_id, id)`,
  );

  // ── Review artifact tables ──────────────────────────────────────────────
  sqlite.run(`CREATE TABLE IF NOT EXISTS review_artifacts (
    id TEXT NOT NULL PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    tool_call_id TEXT NOT NULL,
    commit_ref TEXT,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    total_files INTEGER NOT NULL,
    total_additions INTEGER NOT NULL,
    total_deletions INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`);
  sqlite.run(`CREATE TABLE IF NOT EXISTS artifact_files (
    id TEXT NOT NULL PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES review_artifacts(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    change_type TEXT NOT NULL,
    old_path TEXT,
    additions INTEGER NOT NULL,
    deletions INTEGER NOT NULL,
    viewed INTEGER NOT NULL DEFAULT 0,
    html TEXT NOT NULL,
    hunks_json TEXT,
    full_text_available INTEGER NOT NULL DEFAULT 0,
    full_text_line_count INTEGER,
    full_text_content TEXT
  )`);
  sqlite.run(
    `CREATE INDEX IF NOT EXISTS ix_artifact_files_artifact ON artifact_files(artifact_id)`,
  );
  sqlite.run(`CREATE TABLE IF NOT EXISTS review_comments (
    id TEXT NOT NULL PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES review_artifacts(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES artifact_files(id) ON DELETE CASCADE,
    line_id TEXT,
    line_number INTEGER,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  sqlite.run(
    `CREATE INDEX IF NOT EXISTS ix_review_comments_artifact ON review_comments(artifact_id)`,
  );

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
