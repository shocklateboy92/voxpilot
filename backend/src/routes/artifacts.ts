/**
 * Artifact REST endpoints for the review overlay.
 *
 * GET    /api/artifacts/:id                       — Full artifact with files, hunks, rendered HTML
 * GET    /api/artifacts/:id/files/:fileId/full-text — Lazy full-text fetch
 * PATCH  /api/artifacts/:id/files/:fileId/viewed  — Toggle viewed
 * POST   /api/artifacts/:id/files/:fileId/comments — Add comment
 * DELETE /api/artifacts/:id/comments/:commentId   — Remove comment
 * POST   /api/artifacts/:id/submit                — Submit review
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AuthEnv } from "../middleware/auth";
import { getDb } from "../db";
import {
  getArtifact,
  setFileViewed,
  addComment,
  deleteComment,
  updateArtifactStatus,
  getFileFullText,
  getArtifactComments,
} from "../services/artifacts";
import { addMessage } from "../services/sessions";
import { registry } from "../services/streams";
import { ViewedRequest, AddCommentRequest } from "../schemas/api";

export const artifactRouter = new Hono<AuthEnv>();

// ── GET /api/artifacts/:id ──────────────────────────────────────────────────

artifactRouter.get("/api/artifacts/:id", async (c) => {
  const db = getDb();
  const artifactId = c.req.param("id");
  const detail = await getArtifact(db, artifactId);
  if (!detail) {
    return c.json({ detail: "Artifact not found" }, 404);
  }
  return c.json(detail, 200);
});

// ── GET /api/artifacts/:id/files/:fileId/full-text ──────────────────────────

artifactRouter.get(
  "/api/artifacts/:id/files/:fileId/full-text",
  async (c) => {
    const db = getDb();
    const fileId = c.req.param("fileId");
    const result = await getFileFullText(db, fileId);
    if (!result) {
      return c.json({ detail: "Full text not available" }, 404);
    }
    return c.json(result, 200);
  },
);

// ── PATCH /api/artifacts/:id/files/:fileId/viewed ───────────────────────────

artifactRouter.patch(
  "/api/artifacts/:id/files/:fileId/viewed",
  zValidator("json", ViewedRequest),
  async (c) => {
    const db = getDb();
    const fileId = c.req.param("fileId");
    const body = c.req.valid("json");
    const ok = await setFileViewed(db, fileId, body.viewed);
    if (!ok) {
      return c.json({ detail: "File not found" }, 404);
    }
    return c.json({ viewed: body.viewed }, 200);
  },
);

// ── POST /api/artifacts/:id/files/:fileId/comments ──────────────────────────

artifactRouter.post(
  "/api/artifacts/:id/files/:fileId/comments",
  zValidator("json", AddCommentRequest),
  async (c) => {
    const db = getDb();
    const artifactId = c.req.param("id");
    const fileId = c.req.param("fileId");
    const body = c.req.valid("json");
    const comment = await addComment(
      db,
      artifactId,
      fileId,
      body.content,
      body.line_id,
      body.line_number,
    );
    return c.json(comment, 201);
  },
);

// ── DELETE /api/artifacts/:id/comments/:commentId ───────────────────────────

artifactRouter.delete(
  "/api/artifacts/:id/comments/:commentId",
  async (c) => {
    const db = getDb();
    const commentId = c.req.param("commentId");
    const ok = await deleteComment(db, commentId);
    if (!ok) {
      return c.json({ detail: "Comment not found" }, 404);
    }
    return c.body(null, 204);
  },
);

// ── POST /api/artifacts/:id/submit ──────────────────────────────────────────

artifactRouter.post("/api/artifacts/:id/submit", async (c) => {
  const db = getDb();
  const artifactId = c.req.param("id");

  const detail = await getArtifact(db, artifactId);
  if (!detail) {
    return c.json({ detail: "Artifact not found" }, 404);
  }

  const comments = await getArtifactComments(db, artifactId);
  const hasComments = comments.length > 0;
  const newStatus = hasComments ? "changes_requested" : "approved";

  await updateArtifactStatus(db, artifactId, newStatus as "approved" | "changes_requested");

  // Build a structured review digest message to send to the agent
  const digestParts: string[] = [];
  digestParts.push(
    `Review ${newStatus === "approved" ? "approved" : "changes requested"} for: ${detail.artifact.title}`,
  );

  if (hasComments) {
    digestParts.push("");
    digestParts.push("Comments:");
    for (const comment of comments) {
      const file = detail.files.find((f) => f.id === comment.fileId);
      const filePath = file?.path ?? "unknown file";
      const lineRef = comment.lineNumber
        ? ` (line ${comment.lineNumber})`
        : " (file-level)";
      digestParts.push(`- ${filePath}${lineRef}: ${comment.content}`);
    }
  }

  const digestContent = digestParts.join("\n");

  // Persist as a user message and push to the session stream
  const { sessionId } = detail.artifact;
  await addMessage(db, sessionId, "user", digestContent);

  // Broadcast to any active SSE listeners
  const broadcaster = registry.get(sessionId);
  if (broadcaster) {
    broadcaster.broadcast(
      "message",
      JSON.stringify({
        role: "user",
        content: digestContent,
        created_at: new Date().toISOString(),
      }),
    );
  }

  return c.json({ status: newStatus }, 200);
});
