/**
 * Session-scoped SSE stream, message submission, and tool confirmation.
 *
 * GET  /api/sessions/:id/stream   — persistent EventSource stream
 * POST /api/sessions/:id/messages — fire-and-forget message submission
 * POST /api/sessions/:id/confirm  — approve or deny a tool call
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEStreamingApi } from "hono/streaming";
import { authMiddleware, type AuthEnv } from "../middleware/auth";
import { getDb } from "../db";
import { config } from "../config";
import {
  addMessage,
  autoTitleIfNeeded,
  getMessages,
  getMessagesWithTimestamps,
  sessionExists,
} from "../services/sessions";
import { registry } from "../services/streams";
import { runAgentLoop } from "../services/agent";
import type { SendMessageRequest, ToolConfirmRequest } from "../schemas/api";

const CONFIRM_TIMEOUT_MS = 300_000; // 5 minutes
const KEEPALIVE_TIMEOUT_MS = 30_000; // 30 seconds

export const chatRouter = new Hono<AuthEnv>();
chatRouter.use("*", authMiddleware);

// ── GET /api/sessions/:id/stream ────────────────────────────────────────────

chatRouter.get("/api/sessions/:id/stream", async (c) => {
  const sessionId = c.req.param("id");
  const db = getDb();

  if (!(await sessionExists(db, sessionId))) {
    return c.json({ detail: "Session not found" }, 404);
  }

  const channel = registry.register(sessionId);

  return streamSSE(
    c,
    async (stream: SSEStreamingApi) => {
      try {
        // ── Replay history ──────────────────────────────────────────
        const history = await getMessagesWithTimestamps(db, sessionId);
        for (const msg of history) {
          await stream.writeSSE({
            event: "message",
            data: JSON.stringify(msg),
          });
        }

        await stream.writeSSE({ event: "ready", data: "{}" });

        // ── Live loop ───────────────────────────────────────────────
        while (true) {
          let payload: Awaited<ReturnType<typeof channel.receive>>;
          try {
            payload = await channel.receive(
              AbortSignal.timeout(KEEPALIVE_TIMEOUT_MS),
            );
          } catch {
            // Timeout — send keepalive
            await stream.writeSSE({ event: "keepalive", data: "" });
            continue;
          }

          // Sentinel — clean shutdown
          if (payload === null) break;

          const { content, model, gh_token: ghToken } = payload;

          // Persist user message and auto-title
          await addMessage(db, sessionId, "user", content);
          await autoTitleIfNeeded(db, sessionId, content);

          // Echo user message back to the stream
          const now = new Date().toISOString();
          await stream.writeSSE({
            event: "message",
            data: JSON.stringify({
              role: "user",
              content,
              created_at: now,
            }),
          });

          // Load full conversation for the agent loop
          const messages = await getMessages(db, sessionId);

          // Confirmation callback for tools that need approval
          const requestConfirmation = async (
            callId: string,
            _name: string,
            _args: string,
          ): Promise<boolean> => {
            return registry.awaitConfirmation(
              sessionId,
              callId,
              AbortSignal.timeout(CONFIRM_TIMEOUT_MS),
            );
          };

          for await (const event of runAgentLoop({
            messages,
            model,
            ghToken,
            workDir: config.workDir,
            db,
            sessionId,
            maxIterations: config.maxAgentIterations,
            requestConfirmation,
          })) {
            await stream.writeSSE({
              event: event.event,
              data: event.data,
            });
          }
        }
      } finally {
        registry.unregister(sessionId);
      }
    },
    async (err) => {
      console.error("SSE stream error:", err);
    },
  );
});

// ── POST /api/sessions/:id/messages ─────────────────────────────────────────

chatRouter.post("/api/sessions/:id/messages", async (c) => {
  const sessionId = c.req.param("id");
  const ghToken = c.get("ghToken");
  const db = getDb();

  if (!(await sessionExists(db, sessionId))) {
    return c.json({ detail: "Session not found" }, 404);
  }

  const body = (await c.req.json()) as SendMessageRequest;

  const sent = registry.send(sessionId, {
    content: body.content,
    model: body.model ?? "gpt-4o",
    gh_token: ghToken,
  });

  if (!sent) {
    return c.json({ detail: "No active stream for this session" }, 409);
  }

  return c.body(null, 202);
});

// ── POST /api/sessions/:id/confirm ──────────────────────────────────────────

chatRouter.post("/api/sessions/:id/confirm", async (c) => {
  const sessionId = c.req.param("id");
  const db = getDb();

  if (!(await sessionExists(db, sessionId))) {
    return c.json({ detail: "Session not found" }, 404);
  }

  const body = (await c.req.json()) as ToolConfirmRequest;

  const ok = registry.resolveConfirmation(
    sessionId,
    body.tool_call_id,
    body.approved,
  );

  if (!ok) {
    return c.json(
      { detail: "No pending confirmation for this tool call" },
      409,
    );
  }

  return c.body(null, 202);
});
