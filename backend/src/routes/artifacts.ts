/**
 * Artifact REST endpoints — STUBBED for Phase 1.
 *
 * All routes return 501 until Phase 3 re-implements the review
 * pipeline on top of the OpenCode session store.
 */

import { Hono } from "hono";

export const artifactRouter = new Hono()

  .get("/api/artifacts/:id", (c) =>
    c.json({ detail: "Not implemented — pending Phase 3" }, 501),
  )

  .get("/api/artifacts/:id/files/:fileId/full-text", (c) =>
    c.json({ detail: "Not implemented — pending Phase 3" }, 501),
  )

  .patch("/api/artifacts/:id/files/:fileId/viewed", (c) =>
    c.json({ detail: "Not implemented — pending Phase 3" }, 501),
  )

  .post("/api/artifacts/:id/files/:fileId/comments", (c) =>
    c.json({ detail: "Not implemented — pending Phase 3" }, 501),
  )

  .delete("/api/artifacts/:id/comments/:commentId", (c) =>
    c.json({ detail: "Not implemented — pending Phase 3" }, 501),
  )

  .post("/api/artifacts/:id/submit", (c) =>
    c.json({ detail: "Not implemented — pending Phase 3" }, 501),
  );

