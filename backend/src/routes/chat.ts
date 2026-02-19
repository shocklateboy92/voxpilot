/**
 * Session-scoped SSE stream, message submission, and tool confirmation.
 *
 * GET  /api/sessions/:id/stream   — persistent EventSource stream
 * POST /api/sessions/:id/messages — fire-and-forget message submission
 * POST /api/sessions/:id/confirm  — approve or deny a tool call
 *
 * Multiple SSE connections per session are supported.  A single background
 * processor runs the agent loop and broadcasts events to all listeners.
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
import type { MessagePayload, SessionBroadcaster } from "../services/streams";
import { runAgentLoop } from "../services/agent";
import type { SendMessageRequest, ToolConfirmRequest } from "../schemas/api";

const CONFIRM_TIMEOUT_MS = 300_000; // 5 minutes
const KEEPALIVE_TIMEOUT_MS = 30_000; // 30 seconds

export const chatRouter = new Hono<AuthEnv>();
chatRouter.use("*", authMiddleware);

// ── Message processor (one per session) ─────────────────────────────────────

/**
 * Build a message handler closure for a session.  The handler is invoked
 * once per user message by the SessionBroadcaster's processor loop.
 */
function makeMessageHandler(sessionId: string) {
  return async (payload: MessagePayload, broadcaster: SessionBroadcaster) => {
    const db = getDb();
    const { content, model, gh_token: ghToken } = payload;

    // Persist user message and auto-title
    await addMessage(db, sessionId, "user", content);
    await autoTitleIfNeeded(db, sessionId, content);

    // Echo user message to all listeners
    broadcaster.broadcast(
      "message",
      JSON.stringify({
        role: "user",
        content,
        created_at: new Date().toISOString(),
      }),
    );

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
      isDisconnected: () => broadcaster.listenerCount === 0,
      requestConfirmation,
    })) {
      broadcaster.broadcast(event.event, event.data);
    }
  };
}

// ── GET /api/sessions/:id/stream ────────────────────────────────────────────

chatRouter.get("/api/sessions/:id/stream", async (c) => {
  const sessionId = c.req.param("id");
  const db = getDb();

  if (!(await sessionExists(db, sessionId))) {
    return c.json({ detail: "Session not found" }, 404);
  }

  const { broadcaster, listenerId, events } = registry.subscribe(sessionId);

  // Start the message processor if not already running
  if (!broadcaster.processorRunning) {
    void broadcaster.runProcessor(makeMessageHandler(sessionId));
  }

  return streamSSE(
    c,
    async (stream: SSEStreamingApi) => {
      let disconnected = false;
      stream.onAbort(() => {
        disconnected = true;
      });

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

        // ── Event relay loop ────────────────────────────────────────
        while (!disconnected) {
          let event: Awaited<ReturnType<typeof events.receive>>;
          try {
            event = await events.receive(
              AbortSignal.timeout(KEEPALIVE_TIMEOUT_MS),
            );
          } catch {
            // Timeout — send keepalive (if still connected)
            if (!disconnected) {
              await stream.writeSSE({ event: "keepalive", data: "" });
            }
            continue;
          }

          // Null sentinel — clean shutdown
          if (event === null) break;

          await stream.writeSSE({
            event: event.event,
            data: event.data,
            id: event.id,
          });
        }
      } finally {
        registry.unsubscribe(sessionId, listenerId);
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
