/**
 * Artifact CRUD service.
 *
 * Manages review artifacts, file viewed toggles, comments,
 * and status transitions backed by Drizzle ORM.
 */

import { eq, asc } from "drizzle-orm";
import type { getDb } from "../db";
import {
  reviewArtifacts,
  artifactFiles,
  reviewComments,
  messages,
} from "../schema";
import type { DiffDocument, DiffFile, ReviewComment } from "../schemas/diff-document";
import type { DiffHunk } from "../schemas/diff-document";
import type { ReviewArtifactEvent } from "../schemas/events";

type Db = ReturnType<typeof getDb>;

function nowIso(): string {
  return new Date().toISOString();
}

// ── Create ───────────────────────────────────────────────────────────────────

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

export async function createArtifact(
  db: Db,
  input: CreateArtifactInput,
): Promise<void> {
  await db.insert(reviewArtifacts).values({
    id: input.id,
    version: 1,
    sessionId: input.sessionId,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    commitRef: input.commitRef,
    title: input.title,
    status: "pending",
    totalFiles: input.totalFiles,
    totalAdditions: input.totalAdditions,
    totalDeletions: input.totalDeletions,
    createdAt: nowIso(),
  });
}

export async function createArtifactFile(
  db: Db,
  input: CreateFileInput,
): Promise<void> {
  await db.insert(artifactFiles).values({
    id: input.id,
    artifactId: input.artifactId,
    path: input.path,
    changeType: input.changeType,
    oldPath: input.oldPath,
    additions: input.additions,
    deletions: input.deletions,
    viewed: false,
    html: input.html,
    hunksJson: input.hunksJson,
    fullTextAvailable: input.fullTextAvailable,
    fullTextLineCount: input.fullTextLineCount,
    fullTextContent: input.fullTextContent,
    fullTextHtml: input.fullTextHtml,
  });
}

// ── Read ─────────────────────────────────────────────────────────────────────

export interface ArtifactDetail {
  artifact: DiffDocument;
  files: DiffFile[];
  comments: ReviewComment[];
}

export async function getArtifact(
  db: Db,
  artifactId: string,
): Promise<ArtifactDetail | null> {
  const rows = await db
    .select()
    .from(reviewArtifacts)
    .where(eq(reviewArtifacts.id, artifactId));
  const row = rows[0];
  if (!row) return null;

  const fileRows = await db
    .select()
    .from(artifactFiles)
    .where(eq(artifactFiles.artifactId, artifactId));

  const commentRows = await db
    .select()
    .from(reviewComments)
    .where(eq(reviewComments.artifactId, artifactId))
    .orderBy(asc(reviewComments.createdAt));

  const artifact: DiffDocument = {
    id: row.id,
    version: row.version,
    sessionId: row.sessionId,
    toolName: row.toolName,
    toolCallId: row.toolCallId,
    commitRef: row.commitRef,
    title: row.title,
    status: row.status as DiffDocument["status"],
    totalFiles: row.totalFiles,
    totalAdditions: row.totalAdditions,
    totalDeletions: row.totalDeletions,
    createdAt: row.createdAt,
  };

  const files: DiffFile[] = fileRows.map((f) => ({
    id: f.id,
    artifactId: f.artifactId,
    path: f.path,
    changeType: f.changeType as DiffFile["changeType"],
    oldPath: f.oldPath,
    additions: f.additions,
    deletions: f.deletions,
    viewed: f.viewed,
    html: f.html,
    hunksJson: (f.hunksJson ?? []) as DiffHunk[],
    fullTextAvailable: f.fullTextAvailable,
    fullTextLineCount: f.fullTextLineCount,
    fullTextContent: f.fullTextContent,
    fullTextHtml: f.fullTextHtml ?? null,
  }));

  const comments: ReviewComment[] = commentRows.map((c) => ({
    id: c.id,
    artifactId: c.artifactId,
    fileId: c.fileId,
    lineId: c.lineId,
    lineNumber: c.lineNumber,
    content: c.content,
    createdAt: c.createdAt,
  }));

  return { artifact, files, comments };
}

// ── Viewed toggle ────────────────────────────────────────────────────────────

export async function setFileViewed(
  db: Db,
  fileId: string,
  viewed: boolean,
): Promise<boolean> {
  const updated = await db
    .update(artifactFiles)
    .set({ viewed })
    .where(eq(artifactFiles.id, fileId))
    .returning({ id: artifactFiles.id });
  return updated.length > 0;
}

// ── Comments ─────────────────────────────────────────────────────────────────

export async function addComment(
  db: Db,
  artifactId: string,
  fileId: string,
  content: string,
  lineId?: string | null,
  lineNumber?: number | null,
): Promise<ReviewComment> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.insert(reviewComments).values({
    id,
    artifactId,
    fileId,
    lineId: lineId ?? null,
    lineNumber: lineNumber ?? null,
    content,
    createdAt: now,
  });
  return {
    id,
    artifactId,
    fileId,
    lineId: lineId ?? null,
    lineNumber: lineNumber ?? null,
    content,
    createdAt: now,
  };
}

export async function deleteComment(
  db: Db,
  commentId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(reviewComments)
    .where(eq(reviewComments.id, commentId))
    .returning({ id: reviewComments.id });
  return deleted.length > 0;
}

// ── Status transitions ──────────────────────────────────────────────────────

export async function updateArtifactStatus(
  db: Db,
  artifactId: string,
  status: DiffDocument["status"],
): Promise<boolean> {
  const updated = await db
    .update(reviewArtifacts)
    .set({ status })
    .where(eq(reviewArtifacts.id, artifactId))
    .returning({ id: reviewArtifacts.id });
  return updated.length > 0;
}

// ── Link artifact to message ─────────────────────────────────────────────────

export async function linkArtifactToMessage(
  db: Db,
  toolCallId: string,
  artifactId: string,
): Promise<void> {
  await db
    .update(messages)
    .set({ artifactId })
    .where(eq(messages.toolCallId, toolCallId));
}

// ── Get file full text (lazy) ────────────────────────────────────────────────

export async function getFileFullText(
  db: Db,
  fileId: string,
): Promise<{ content: string; lineCount: number } | null> {
  const rows = await db
    .select({
      fullTextAvailable: artifactFiles.fullTextAvailable,
      fullTextContent: artifactFiles.fullTextContent,
      fullTextLineCount: artifactFiles.fullTextLineCount,
    })
    .from(artifactFiles)
    .where(eq(artifactFiles.id, fileId));
  const row = rows[0];
  if (!row || !row.fullTextAvailable || row.fullTextContent === null) {
    return null;
  }
  return { content: row.fullTextContent, lineCount: row.fullTextLineCount ?? 0 };
}

// ── Get all comments for an artifact ─────────────────────────────────────────

export async function getSessionArtifactSummaries(
  db: Db,
  sessionId: string,
): Promise<ReviewArtifactEvent[]> {
  const artRows = await db
    .select()
    .from(reviewArtifacts)
    .where(eq(reviewArtifacts.sessionId, sessionId));

  const results: ReviewArtifactEvent[] = [];
  for (const row of artRows) {
    const fileRows = await db
      .select({
        id: artifactFiles.id,
        path: artifactFiles.path,
        changeType: artifactFiles.changeType,
        additions: artifactFiles.additions,
        deletions: artifactFiles.deletions,
        viewed: artifactFiles.viewed,
      })
      .from(artifactFiles)
      .where(eq(artifactFiles.artifactId, row.id));

    results.push({
      artifactId: row.id,
      title: row.title,
      status: row.status,
      totalFiles: row.totalFiles,
      totalAdditions: row.totalAdditions,
      totalDeletions: row.totalDeletions,
      files: fileRows,
    });
  }
  return results;
}

export async function getArtifactComments(
  db: Db,
  artifactId: string,
): Promise<ReviewComment[]> {
  const rows = await db
    .select()
    .from(reviewComments)
    .where(eq(reviewComments.artifactId, artifactId))
    .orderBy(asc(reviewComments.createdAt));
  return rows.map((c) => ({
    id: c.id,
    artifactId: c.artifactId,
    fileId: c.fileId,
    lineId: c.lineId,
    lineNumber: c.lineNumber,
    content: c.content,
    createdAt: c.createdAt,
  }));
}
