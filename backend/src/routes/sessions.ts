/**
 * Session CRUD routes.
 */

import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { getDb } from "../db";
import {
  listSessions,
  createSession,
  getSession,
  deleteSession,
  updateSessionTitle,
} from "../services/sessions";

export const sessionsRouter = new Hono<AuthEnv>();

sessionsRouter.get("/api/sessions", async (c) => {
  const db = getDb();
  const result = await listSessions(db);
  return c.json(result, 200);
});

sessionsRouter.post("/api/sessions", async (c) => {
  const db = getDb();
  const session = await createSession(db);
  return c.json(session, 201);
});

sessionsRouter.get("/api/sessions/:session_id", async (c) => {
  const db = getDb();
  const sessionId = c.req.param("session_id");
  const session = await getSession(db, sessionId);
  if (!session) {
    return c.json({ detail: "Session not found" }, 404);
  }
  return c.json(session, 200);
});

sessionsRouter.delete("/api/sessions/:session_id", async (c) => {
  const db = getDb();
  const sessionId = c.req.param("session_id");
  const deleted = await deleteSession(db, sessionId);
  if (!deleted) {
    return c.json({ detail: "Session not found" }, 404);
  }
  return c.body(null, 204);
});

sessionsRouter.patch("/api/sessions/:session_id", async (c) => {
  const db = getDb();
  const sessionId = c.req.param("session_id");
  const body = await c.req.json<{ title: string }>();
  const session = await updateSessionTitle(db, sessionId, body.title);
  if (!session) {
    return c.json({ detail: "Session not found" }, 404);
  }
  return c.json(session, 200);
});
