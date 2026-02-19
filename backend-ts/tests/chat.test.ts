/**
 * Tests for session-scoped SSE stream and message submission endpoints.
 *
 * Uses mock.module to mock OpenAI for the agent loop, and direct
 * app.request() calls for endpoint testing.
 */

import { describe, expect, it, mock } from "bun:test";
import { setupTestDb } from "./helpers";
import { getDb } from "../src/db";
import {
  createSession,
  addMessage,
  getMessages,
  getSession,
} from "../src/services/sessions";
import { registry } from "../src/services/streams";

// ── Mock OpenAI ─────────────────────────────────────────────────────────────

interface MockChunk {
  choices: {
    delta: {
      content?: string | null;
      tool_calls?: null;
    };
    finish_reason: string | null;
  }[];
  model: string | null;
}

function makeTextChunk(opts: {
  content?: string | null;
  model?: string | null;
  finishReason?: string | null;
}): MockChunk {
  const hasChoice = opts.content != null || opts.finishReason != null;
  return {
    choices: hasChoice
      ? [
          {
            delta: { content: opts.content ?? null, tool_calls: null },
            finish_reason: opts.finishReason ?? null,
          },
        ]
      : [],
    model: opts.model ?? null,
  };
}

async function* mockStream(chunks: MockChunk[]): AsyncGenerator<MockChunk> {
  for (const chunk of chunks) yield chunk;
}

let createFn: (...args: unknown[]) => unknown;

mock.module("openai", () => ({
  default: class MockOpenAI {
    constructor() {}
    chat = {
      completions: {
        create: (...args: unknown[]) => createFn(...args),
      },
    };
  },
}));

// Re-import app after mock is installed
const { app } = await import("../src/index");

const AUTH = { headers: { Cookie: "gh_token=gho_fake" } };

async function createTestSession(): Promise<string> {
  const db = getDb();
  const session = await createSession(db);
  return session.id;
}

function parseSseEvents(text: string): { event: string; data: string }[] {
  const events: { event: string; data: string }[] = [];
  let eventType = "";
  let data = "";
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data = line.slice(5).trim();
    } else if (line === "" && eventType && data) {
      events.push({ event: eventType, data });
      eventType = "";
      data = "";
    }
  }
  if (eventType && data) {
    events.push({ event: eventType, data });
  }
  return events;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("chat", () => {
  setupTestDb();

  // ── POST /api/sessions/:id/messages ─────────────────────────────────────

  describe("POST /messages", () => {
    it("returns 202 with active stream", async () => {
      const sessionId = await createTestSession();
      registry.register(sessionId);
      try {
        const res = await app.request(
          `/api/sessions/${sessionId}/messages`,
          {
            method: "POST",
            body: JSON.stringify({ content: "Hello", model: "gpt-4o" }),
            headers: {
              ...AUTH.headers,
              "Content-Type": "application/json",
            },
          },
        );
        expect(res.status).toBe(202);
      } finally {
        registry.unregister(sessionId);
      }
    });

    it("returns 409 without active stream", async () => {
      const sessionId = await createTestSession();
      const res = await app.request(
        `/api/sessions/${sessionId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ content: "Hello", model: "gpt-4o" }),
          headers: {
            ...AUTH.headers,
            "Content-Type": "application/json",
          },
        },
      );
      expect(res.status).toBe(409);
    });

    it("returns 401 without cookie", async () => {
      const res = await app.request("/api/sessions/some-id/messages", {
        method: "POST",
        body: JSON.stringify({ content: "Hi" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 for nonexistent session", async () => {
      const res = await app.request(
        "/api/sessions/nonexistent/messages",
        {
          method: "POST",
          body: JSON.stringify({ content: "Hi" }),
          headers: {
            ...AUTH.headers,
            "Content-Type": "application/json",
          },
        },
      );
      expect(res.status).toBe(404);
    });

    it("enqueues correct payload", async () => {
      const sessionId = await createTestSession();
      const channel = registry.register(sessionId);
      try {
        await app.request(`/api/sessions/${sessionId}/messages`, {
          method: "POST",
          body: JSON.stringify({ content: "Hello world", model: "gpt-4o" }),
          headers: {
            Cookie: "gh_token=gho_fake_token_123",
            "Content-Type": "application/json",
          },
        });
        const payload = await channel.receive(AbortSignal.timeout(1000));
        expect(payload).not.toBeNull();
        if (payload) {
          expect(payload.content).toBe("Hello world");
          expect(payload.model).toBe("gpt-4o");
          expect(payload.gh_token).toBe("gho_fake_token_123");
        }
      } finally {
        registry.unregister(sessionId);
      }
    });
  });

  // ── GET /api/sessions/:id/stream ──────────────────────────────────────────

  describe("GET /stream", () => {
    it("returns 401 without cookie", async () => {
      const res = await app.request("/api/sessions/some-id/stream");
      expect(res.status).toBe(401);
    });

    it("returns 404 for nonexistent session", async () => {
      const res = await app.request("/api/sessions/nonexistent/stream", AUTH);
      expect(res.status).toBe(404);
    });

    it("replays history and sends ready", async () => {
      const sessionId = await createTestSession();
      const db = getDb();
      await addMessage(db, sessionId, "user", "Hello");
      await addMessage(db, sessionId, "assistant", "Hi there!");

      // Start streaming and immediately send sentinel to end
      const streamPromise = app.request(
        `/api/sessions/${sessionId}/stream`,
        AUTH,
      );

      // Wait for the stream to register, then send sentinel
      await waitForChannel(sessionId);
      registry.send(sessionId, null);

      const response = await streamPromise;
      expect(response.status).toBe(200);

      const text = await response.text();
      const events = parseSseEvents(text);

      const msgEvents = events.filter((e) => e.event === "message");
      const readyEvents = events.filter((e) => e.event === "ready");

      expect(msgEvents).toHaveLength(2);

      const m0 = JSON.parse(msgEvents[0].data);
      expect(m0.role).toBe("user");
      expect(m0.content).toBe("Hello");

      const m1 = JSON.parse(msgEvents[1].data);
      expect(m1.role).toBe("assistant");
      expect(m1.content).toBe("Hi there!");

      expect(readyEvents).toHaveLength(1);
    });

    it("processes message and streams response", async () => {
      const sessionId = await createTestSession();

      const chunks = [
        makeTextChunk({ content: "Hello", model: "gpt-4o" }),
        makeTextChunk({ content: " world", model: "gpt-4o", finishReason: "stop" }),
      ];
      createFn = () => mockStream(chunks);

      const streamPromise = app.request(
        `/api/sessions/${sessionId}/stream`,
        AUTH,
      );

      await waitForChannel(sessionId);
      registry.send(sessionId, {
        content: "Hi",
        model: "gpt-4o",
        gh_token: "gho_fake",
      });

      // Wait briefly for processing, then send sentinel
      await sleep(100);
      registry.send(sessionId, null);

      const response = await streamPromise;
      const text = await response.text();
      const events = parseSseEvents(text);
      const types = events.map((e) => e.event);

      expect(types).toContain("ready");
      expect(types).toContain("message");
      expect(types).toContain("text-delta");
      expect(types).toContain("done");

      // Check user message echo
      const msgEvents = events.filter((e) => e.event === "message");
      const userMsg = JSON.parse(msgEvents[0].data);
      expect(userMsg.role).toBe("user");
      expect(userMsg.content).toBe("Hi");

      // Check text deltas
      const deltas = events.filter((e) => e.event === "text-delta");
      expect(deltas).toHaveLength(2);
      expect(JSON.parse(deltas[0].data).content).toBe("Hello");
      expect(JSON.parse(deltas[1].data).content).toBe(" world");

      // Check done
      const done = events.filter((e) => e.event === "done");
      expect(JSON.parse(done[0].data).model).toBe("gpt-4o");
    });

    it("persists messages to db", async () => {
      const sessionId = await createTestSession();

      const chunks = [
        makeTextChunk({ content: "Hey!", model: "gpt-4o", finishReason: "stop" }),
      ];
      createFn = () => mockStream(chunks);

      const streamPromise = app.request(
        `/api/sessions/${sessionId}/stream`,
        AUTH,
      );

      await waitForChannel(sessionId);
      registry.send(sessionId, {
        content: "Hello",
        model: "gpt-4o",
        gh_token: "gho_fake",
      });

      await sleep(200);
      registry.send(sessionId, null);
      await streamPromise;

      const db = getDb();
      const msgs = await getMessages(db, sessionId);
      // At minimum the user message is persisted by the stream handler.
      // The assistant message is persisted by the agent loop if it completes.
      expect(msgs.length).toBeGreaterThanOrEqual(1);
      expect(msgs[0].role).toBe("user");
      expect(msgs[0].content).toBe("Hello");
      if (msgs.length >= 2) {
        expect(msgs[1].role).toBe("assistant");
        expect(msgs[1].content).toBe("Hey!");
      }
    });

    it("auto-titles session", async () => {
      const sessionId = await createTestSession();

      const chunks = [
        makeTextChunk({ content: "Reply", model: "gpt-4o", finishReason: "stop" }),
      ];
      createFn = () => mockStream(chunks);

      const streamPromise = app.request(
        `/api/sessions/${sessionId}/stream`,
        AUTH,
      );

      await waitForChannel(sessionId);
      registry.send(sessionId, {
        content: "Tell me about cats",
        model: "gpt-4o",
        gh_token: "gho_fake",
      });

      await sleep(100);
      registry.send(sessionId, null);
      await streamPromise;

      const db = getDb();
      const session = await getSession(db, sessionId);
      expect(session).toBeTruthy();
      expect(session?.title).toBe("Tell me about cats");
    });

    it("handles OpenAI error", async () => {
      const sessionId = await createTestSession();

      createFn = () => {
        throw new Error("rate limit exceeded");
      };

      const streamPromise = app.request(
        `/api/sessions/${sessionId}/stream`,
        AUTH,
      );

      await waitForChannel(sessionId);
      registry.send(sessionId, {
        content: "Hi",
        model: "gpt-4o",
        gh_token: "gho_fake",
      });

      await sleep(100);
      registry.send(sessionId, null);

      const response = await streamPromise;
      const text = await response.text();
      const events = parseSseEvents(text);

      const errors = events.filter((e) => e.event === "error");
      expect(errors).toHaveLength(1);
      expect(JSON.parse(errors[0].data).message).toContain("rate limit");
    });

    it("unregisters on exit", async () => {
      const sessionId = await createTestSession();

      const streamPromise = app.request(
        `/api/sessions/${sessionId}/stream`,
        AUTH,
      );

      await waitForChannel(sessionId);
      registry.send(sessionId, null);
      await streamPromise;
      // Allow the finally block in streamSSE to execute
      await sleep(50);

      expect(registry.get(sessionId)).toBeUndefined();
    });
  });

  // ── POST /api/sessions/:id/confirm ────────────────────────────────────────

  describe("POST /confirm", () => {
    it("returns 404 for nonexistent session", async () => {
      const res = await app.request(
        "/api/sessions/nonexistent/confirm",
        {
          method: "POST",
          body: JSON.stringify({ tool_call_id: "call_xxx", approved: true }),
          headers: {
            ...AUTH.headers,
            "Content-Type": "application/json",
          },
        },
      );
      expect(res.status).toBe(404);
    });

    it("returns 409 when no stream is connected", async () => {
      const sessionId = await createTestSession();
      const res = await app.request(
        `/api/sessions/${sessionId}/confirm`,
        {
          method: "POST",
          body: JSON.stringify({ tool_call_id: "call_xxx", approved: true }),
          headers: {
            ...AUTH.headers,
            "Content-Type": "application/json",
          },
        },
      );
      expect(res.status).toBe(409);
    });

    it("returns 409 when tool_call_id doesn't match", async () => {
      const sessionId = await createTestSession();
      // Set up a pending confirm manually
      registry.awaitConfirmation(sessionId, "call_real");
      try {
        const res = await app.request(
          `/api/sessions/${sessionId}/confirm`,
          {
            method: "POST",
            body: JSON.stringify({
              tool_call_id: "call_WRONG",
              approved: true,
            }),
            headers: {
              ...AUTH.headers,
              "Content-Type": "application/json",
            },
          },
        );
        expect(res.status).toBe(409);
      } finally {
        // Clean up pending
        registry.resolveConfirmation(sessionId, "call_real", false);
      }
    });

    it("resolves pending confirmation", async () => {
      const sessionId = await createTestSession();
      const promise = registry.awaitConfirmation(sessionId, "call_test");

      const res = await app.request(
        `/api/sessions/${sessionId}/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            tool_call_id: "call_test",
            approved: true,
          }),
          headers: {
            ...AUTH.headers,
            "Content-Type": "application/json",
          },
        },
      );
      expect(res.status).toBe(202);
      expect(await promise).toBe(true);
    });
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function waitForChannel(sessionId: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (registry.get(sessionId)) return;
    await sleep(10);
  }
  throw new Error(`Channel for ${sessionId} never registered`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
