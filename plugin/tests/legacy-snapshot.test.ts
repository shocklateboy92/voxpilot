import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { legacySnapshot } from "../src/services/legacy-snapshot";

test("old review cards load from a read-only legacy cache with full content", async () => {
  const root = await mkdtemp("/tmp/opencode/voxpilot-legacy-");
  const path = `${root}/voxpilot.db`;
  try {
    const db = new Database(path);
    db.run(`CREATE TABLE diff_entries (id TEXT PRIMARY KEY, from_ref TEXT, to_ref TEXT,
      resolved_from TEXT, resolved_to TEXT, repo_root TEXT, created_at INTEGER);
      CREATE TABLE diff_entry_files (entry_id TEXT, file_path TEXT, additions INTEGER,
      deletions INTEGER, before_content TEXT, after_content TEXT);`);
    db.run("INSERT INTO diff_entries VALUES (?, ?, ?, ?, ?, ?, ?)", [
      "old-id",
      "HEAD",
      "WORKTREE",
      "sha",
      "WORKTREE",
      root,
      1234,
    ]);
    db.run("INSERT INTO diff_entry_files VALUES (?, ?, ?, ?, ?, ?)", [
      "old-id",
      "test.ts",
      1,
      1,
      "before\n",
      "after\n",
    ]);
    db.close();
    const before = await Bun.file(path).arrayBuffer();
    const entry = legacySnapshot("old-id", path);
    expect(entry?.createdAt).toBe(1234000);
    expect(entry?.files[0]?.beforeContent).toBe("before\n");
    expect(entry?.files[0]?.afterContent).toBe("after\n");
    expect(legacySnapshot("missing", path)).toBeNull();
    expect(await Bun.file(path).arrayBuffer()).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
