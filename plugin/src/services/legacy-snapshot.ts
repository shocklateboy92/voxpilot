import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Snapshot } from "../rpc";

/** Read-only bridge for review cards created by the former backend. */
export function legacySnapshot(
  id: string,
  path = process.env.VOXPILOT_LEGACY_DB,
) {
  if (!path || !existsSync(path)) return null;
  const db = new Database(resolve(path), { readonly: true });
  try {
    const row = db
      .query(`SELECT id, from_ref AS fromRef, to_ref AS toRef,
      resolved_from AS resolvedFrom, resolved_to AS resolvedTo,
      repo_root AS repoRoot, created_at * 1000 AS createdAt
      FROM diff_entries WHERE id = ?`)
      .get(id);
    if (!row || typeof row !== "object") return null;
    const files = db
      .query(`SELECT file_path AS filePath, additions, deletions,
      before_content AS beforeContent, after_content AS afterContent
      FROM diff_entry_files WHERE entry_id = ? ORDER BY rowid`)
      .all(id);
    return Snapshot.parse({ ...row, files });
  } finally {
    db.close();
  }
}
