/**
 * Core diff data types used by diff-render and review artifacts.
 *
 * Extracted from the old Zod schemas so that diff-render.ts and its
 * tests can compile without dragging in the deleted Drizzle / Zod
 * infrastructure.  These will be replaced by OpenCode-native types
 * once the review pipeline is rebuilt in Phase 3.
 */

export type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
  id: string;
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  content: string;
  fullTextLine: number | null;
}

export interface DiffHunk {
  id: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}
