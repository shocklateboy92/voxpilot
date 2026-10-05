/**
 * Core diff data types used by diff-render and review artifacts.
 *
 * Internal rendering data after width-aware formatting. Public RPC response
 * types are inferred from the shared schemas in ../rpc.ts.
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
