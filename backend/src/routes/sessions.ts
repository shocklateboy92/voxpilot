/**
 * Session CRUD routes.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getDb } from "../db";
import type { AuthEnv } from "../middleware/auth";
import { SessionUpdate } from "../schemas/api";
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSessionTitle,
} from "../services/sessions";

export const sessionsRouter = new Hono<AuthEnv>()
  .get("/api/sessions", async (c) => {
    const db = getDb();
    const result = await listSessions(db);
    return c.json(result, 200);
  })
  .post("/api/sessions", async (c) => {
    const db = getDb();
    const session = await createSession(db);
    return c.json(session, 201);
  })
  .get("/api/sessions/:session_id", async (c) => {
    const db = getDb();
    const sessionId = c.req.param("session_id");
    const session = await getSession(db, sessionId);
    if (!session) {
      return c.json({ detail: "Session not found" }, 404);
    }
    return c.json(session, 200);
  })
  .delete("/api/sessions/:session_id", async (c) => {
    const db = getDb();
    const sessionId = c.req.param("session_id");
    const deleted = await deleteSession(db, sessionId);
    if (!deleted) {
      return c.json({ detail: "Session not found" }, 404);
    }
    return c.body(null, 204);
  })
  .patch(
    "/api/sessions/:session_id",
    zValidator("json", SessionUpdate),
    async (c) => {
      const db = getDb();
      const sessionId = c.req.param("session_id");
      const body = c.req.valid("json");
      const session = await updateSessionTitle(db, sessionId, body.title);
      if (!session) {
        return c.json({ detail: "Session not found" }, 404);
      }
      return c.json(session, 200);
    },
  );
