/**
 * Artifact CRUD service — STUBBED for Phase 1.
 *
 * All Drizzle-backed implementations have been removed.  The type
 * signatures are preserved so that routes/artifacts.ts (also stubbed)
 * can still compile.  Phase 3 will reimplement this against the
 * OpenCode session store.
 */

import type { DiffHunk } from "./diff-types";

// ── Placeholder types (were Zod-inferred) ────────────────────────────────────

export type ArtifactStatus = "pending" | "approved" | "changes_requested";

export interface DiffDocumentLike {
  id: string;
  version: number;
  sessionId: string;
  toolName: string;
  toolCallId: string;
  commitRef: string | null;
  title: string;
  status: ArtifactStatus;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  createdAt: string;
}

export interface DiffFileLike {
  id: string;
  artifactId: string;
  path: string;
  changeType: string;
  oldPath: string | null;
  additions: number;
  deletions: number;
  viewed: boolean;
  html: string;
  hunksJson: DiffHunk[];
  fullTextAvailable: boolean;
  fullTextLineCount: number | null;
  fullTextContent: string | null;
  fullTextHtml: string | null;
}

export interface ReviewCommentLike {
  id: string;
  artifactId: string;
  fileId: string;
  lineId: string | null;
  lineNumber: number | null;
  content: string;
  createdAt: string;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface CreateArtifactInput {
  id: string;
  sessionId: string;
  toolName: string;
  toolCallId: string;
  commitRef: string | null;
  title: string;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
}

export interface CreateFileInput {
  id: string;
  artifactId: string;
  path: string;
  changeType: string;
  oldPath: string | null;
  additions: number;
  deletions: number;
  html: string;
  hunksJson: DiffHunk[];
  fullTextAvailable: boolean;
  fullTextLineCount: number | null;
  fullTextContent: string | null;
  fullTextHtml: string | null;
}

// ── Read result ──────────────────────────────────────────────────────────────

export interface ArtifactDetail {
  artifact: DiffDocumentLike;
  files: DiffFileLike[];
  comments: ReviewCommentLike[];
}

// ── Stub implementations (Phase 3) ──────────────────────────────────────────

// TODO: Phase 3 — reimplement against OpenCode session store

export async function createArtifact(
  _input: CreateArtifactInput,
): Promise<void> {
  throw new Error("Not implemented — pending Phase 3");
}

export async function createArtifactFile(
  _input: CreateFileInput,
): Promise<void> {
  throw new Error("Not implemented — pending Phase 3");
}

export async function getArtifact(
  _artifactId: string,
): Promise<ArtifactDetail | null> {
  throw new Error("Not implemented — pending Phase 3");
}

export async function setFileViewed(
  _fileId: string,
  _viewed: boolean,
): Promise<boolean> {
  throw new Error("Not implemented — pending Phase 3");
}

export async function addComment(
  _artifactId: string,
  _fileId: string,
  _content: string,
  _lineId?: string | null,
  _lineNumber?: number | null,
): Promise<ReviewCommentLike> {
  throw new Error("Not implemented — pending Phase 3");
}

export async function deleteComment(
  _commentId: string,
): Promise<boolean> {
  throw new Error("Not implemented — pending Phase 3");
}

export async function updateArtifactStatus(
  _artifactId: string,
  _status: ArtifactStatus,
): Promise<boolean> {
  throw new Error("Not implemented — pending Phase 3");
}

export async function getFileFullText(
  _fileId: string,
): Promise<{ content: string; lineCount: number } | null> {
  throw new Error("Not implemented — pending Phase 3");
}

export async function getArtifactComments(
  _artifactId: string,
): Promise<ReviewCommentLike[]> {
  throw new Error("Not implemented — pending Phase 3");
}

