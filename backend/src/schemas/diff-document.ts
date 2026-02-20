/**
 * Zod schemas for the review artifact data model.
 *
 * DiffDocument → DiffFile → DiffHunk → DiffLine
 * Plus ReviewComment for user feedback.
 */

import { z } from "zod/v4";

// ── DiffLine ─────────────────────────────────────────────────────────────────

export const DiffLineKind = z.enum(["context", "add", "del"]);
export type DiffLineKind = z.infer<typeof DiffLineKind>;

export const DiffLine = z.object({
  id: z.string(),
  kind: DiffLineKind,
  oldLine: z.number().nullable(),
  newLine: z.number().nullable(),
  content: z.string(),
  fullTextLine: z.number().nullable(),
});
export type DiffLine = z.infer<typeof DiffLine>;

// ── DiffHunk ─────────────────────────────────────────────────────────────────

export const DiffHunk = z.object({
  id: z.string(),
  header: z.string(),
  oldStart: z.number(),
  oldLines: z.number(),
  newStart: z.number(),
  newLines: z.number(),
  lines: z.array(DiffLine),
});
export type DiffHunk = z.infer<typeof DiffHunk>;

// ── DiffFile ─────────────────────────────────────────────────────────────────

export const ChangeType = z.enum(["added", "modified", "deleted", "renamed"]);
export type ChangeType = z.infer<typeof ChangeType>;

export const DiffFile = z.object({
  id: z.string(),
  artifactId: z.string(),
  path: z.string(),
  changeType: ChangeType,
  oldPath: z.string().nullable(),
  additions: z.number(),
  deletions: z.number(),
  viewed: z.boolean(),
  html: z.string(),
  hunksJson: z.array(DiffHunk),
  fullTextAvailable: z.boolean(),
  fullTextLineCount: z.number().nullable(),
  fullTextContent: z.string().nullable(),
  fullTextHtml: z.string().nullable(),
});
export type DiffFile = z.infer<typeof DiffFile>;

// ── ArtifactStatus ───────────────────────────────────────────────────────────

export const ArtifactStatus = z.enum([
  "pending",
  "approved",
  "changes_requested",
]);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

// ── DiffDocument ─────────────────────────────────────────────────────────────

export const DiffDocument = z.object({
  id: z.string(),
  version: z.number(),
  sessionId: z.string(),
  toolName: z.string(),
  toolCallId: z.string(),
  commitRef: z.string().nullable(),
  title: z.string(),
  status: ArtifactStatus,
  totalFiles: z.number(),
  totalAdditions: z.number(),
  totalDeletions: z.number(),
  createdAt: z.string(),
});
export type DiffDocument = z.infer<typeof DiffDocument>;

// ── ReviewComment ────────────────────────────────────────────────────────────

export const ReviewComment = z.object({
  id: z.string(),
  artifactId: z.string(),
  fileId: z.string(),
  lineId: z.string().nullable(),
  lineNumber: z.number().nullable(),
  content: z.string(),
  createdAt: z.string(),
});
export type ReviewComment = z.infer<typeof ReviewComment>;
