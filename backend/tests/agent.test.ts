/**
 * Tests for the agentic loop — exercises runAgentLoop directly by mocking
 * the OpenAI constructor via bun's mock.module().
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb } from "../src/db";
import { createSession, getMessages } from "../src/services/sessions";

// ── Mock helpers ────────────────────────────────────────────────────────────

interface MockDelta {
  content?: string | null;
  tool_calls?: MockToolCallDelta[] | null;
}

interface MockToolCallDelta {
  index: number;
  id?: string | null;
  function?: { name?: string | null; arguments?: string | null } | null;
}

interface MockChunk {
  choices: {
    delta: MockDelta;
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

function makeToolCallChunk(opts: {
  index?: number;
  callId?: string | null;
  name?: string | null;
  arguments?: string | null;
  finishReason?: string | null;
  model?: string | null;
}): MockChunk {
  const tcDelta: MockToolCallDelta = {
    index: opts.index ?? 0,
    id: opts.callId ?? null,
    function:
      opts.name || opts.arguments
        ? { name: opts.name ?? null, arguments: opts.arguments ?? null }
        : null,
  };
  return {
    choices: [
      {
        delta: { content: null, tool_calls: [tcDelta] },
        finish_reason: opts.finishReason ?? null,
      },
    ],
    model: opts.model ?? null,
  };
}

async function* mockStream(chunks: MockChunk[]): AsyncGenerator<MockChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ── Mocking OpenAI ──────────────────────────────────────────────────────────

let createFn: (...args: unknown[]) => unknown;

mock.module("openai", () => ({
  default: class MockOpenAI {
    static APIError = class extends Error {};
    chat = {
      completions: {
        create: (...args: unknown[]) => createFn(...args),
      },
    };
  },
}));

// Re-import after mock is installed
const { runAgentLoop } = await import("../src/services/agent");

// ── Test setup ──────────────────────────────────────────────────────────────

let workDir: string;

beforeEach(async () => {
  process.env.VOXPILOT_DB_PATH = ":memory:";
  workDir = await mkdtemp(join(tmpdir(), "voxpilot-agent-test-"));
  await mkdir(join(workDir, "src"));
  await writeFile(join(workDir, "src", "main.py"), "# main\nprint('hello')\n");
  await writeFile(join(workDir, "README.md"), "# Project\n");
});

afterEach(async () => {
  closeDb();
  await rm(workDir, { recursive: true, force: true });
});

async function collectEvents(
  gen: AsyncGenerator<{ event: string; data: string }>,
): Promise<{ event: string; data: string }[]> {
  const events: { event: string; data: string }[] = [];
  for await (const e of gen) {
    events.push(e);
  }
  return events;
}

async function createTestSession(): Promise<string> {
  const db = getDb();
  const session = await createSession(db);
  return session.id;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("runAgentLoop", () => {
  it("streams text-only response", async () => {
    const sessionId = await createTestSession();

    const chunks = [
      makeTextChunk({ content: "Just a plain answer.", model: "gpt-4o" }),
      makeTextChunk({ finishReason: "stop", model: "gpt-4o" }),
    ];
    createFn = () => mockStream(chunks);

    const events = await collectEvents(
      runAgentLoop({
        messages: [{ role: "user", content: "What is 2+2?", tool_calls: null }],
        model: "gpt-4o",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
      }),
    );

    const types = events.map((e) => e.event);
    expect(types).toContain("text-delta");
    expect(types).toContain("done");
    expect(types).not.toContain("tool-call");
    expect(types).not.toContain("tool-result");

    // Check done payload has model
    const done = events.find((e) => e.event === "done");
    const doneData = JSON.parse(done?.data ?? "{}");
    expect(doneData.model).toBe("gpt-4o");
  });

  it("handles tool call and loops back", async () => {
    const sessionId = await createTestSession();

    const toolCallChunks = [
      makeToolCallChunk({
        index: 0,
        callId: "call_123",
        name: "list_directory",
        arguments: '{"path": "."}',
        finishReason: "tool_calls",
      }),
    ];

    const textChunks = [
      makeTextChunk({ content: "Here are the files.", model: "gpt-4o" }),
      makeTextChunk({ finishReason: "stop", model: "gpt-4o" }),
    ];

    let callCount = 0;
    createFn = () => {
      callCount++;
      if (callCount === 1) return mockStream(toolCallChunks);
      return mockStream(textChunks);
    };

    const events = await collectEvents(
      runAgentLoop({
        messages: [{ role: "user", content: "What files?", tool_calls: null }],
        model: "gpt-4o",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
      }),
    );

    const types = events.map((e) => e.event);
    expect(types).toContain("tool-call");
    expect(types).toContain("tool-result");
    expect(types).toContain("text-delta");
    expect(types).toContain("done");
    expect(callCount).toBe(2);

    // Verify tool-call event content
    const tcEvent = events.find((e) => e.event === "tool-call");
    const tc = JSON.parse(tcEvent?.data ?? "{}");
    expect(tc.id).toBe("call_123");
    expect(tc.name).toBe("list_directory");

    // Verify tool-result
    const trEvent = events.find((e) => e.event === "tool-result");
    const tr = JSON.parse(trEvent?.data ?? "{}");
    expect(tr.id).toBe("call_123");
    expect(tr.is_error).toBe(false);
  });

  it("persists messages to db", async () => {
    const sessionId = await createTestSession();

    const toolCallChunks = [
      makeToolCallChunk({
        index: 0,
        callId: "call_abc",
        name: "read_file",
        arguments: '{"path": "nonexistent.txt"}',
        finishReason: "tool_calls",
      }),
    ];

    const textChunks = [
      makeTextChunk({
        content: "The file doesn't exist.",
        model: "gpt-4o",
        finishReason: "stop",
      }),
    ];

    let callCount = 0;
    createFn = () => {
      callCount++;
      return callCount === 1
        ? mockStream(toolCallChunks)
        : mockStream(textChunks);
    };

    await collectEvents(
      runAgentLoop({
        messages: [{ role: "user", content: "Read a file", tool_calls: null }],
        model: "gpt-4o",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
      }),
    );

    const msgs = await getMessages(getDb(), sessionId);
    // assistant (with tool_calls), tool, assistant (final text) = 3
    // (user message is passed in, not persisted by the loop)
    expect(msgs.length).toBe(3);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].tool_calls).toBeTruthy();
    expect(msgs[1].role).toBe("tool");
    expect(msgs[1].tool_call_id).toBe("call_abc");
    expect(msgs[1].content).toContain("Error:");
    expect(msgs[2].role).toBe("assistant");
    expect(msgs[2].content).toBe("The file doesn't exist.");
  });

  it("stops at iteration limit", async () => {
    const sessionId = await createTestSession();

    createFn = () =>
      mockStream([
        makeToolCallChunk({
          index: 0,
          callId: "call_loop",
          name: "list_directory",
          arguments: '{"path": "."}',
          finishReason: "tool_calls",
        }),
      ]);

    const events = await collectEvents(
      runAgentLoop({
        messages: [{ role: "user", content: "Loop", tool_calls: null }],
        model: "gpt-4o",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
        maxIterations: 3,
      }),
    );

    const errorEvents = events.filter((e) => e.event === "error");
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    const lastErr = JSON.parse(errorEvents[errorEvents.length - 1].data);
    expect(lastErr.message.toLowerCase()).toContain("maximum iterations");
  });

  it("handles unknown tool", async () => {
    const sessionId = await createTestSession();

    const toolCallChunks = [
      makeToolCallChunk({
        index: 0,
        callId: "call_unknown",
        name: "nonexistent_tool",
        arguments: "{}",
        finishReason: "tool_calls",
      }),
    ];

    const textChunks = [
      makeTextChunk({
        content: "Sorry, that tool doesn't exist.",
        model: "gpt-4o",
        finishReason: "stop",
      }),
    ];

    let callCount = 0;
    createFn = () => {
      callCount++;
      return callCount === 1
        ? mockStream(toolCallChunks)
        : mockStream(textChunks);
    };

    const events = await collectEvents(
      runAgentLoop({
        messages: [
          { role: "user", content: "Use a weird tool", tool_calls: null },
        ],
        model: "gpt-4o",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
      }),
    );

    const trEvents = events.filter((e) => e.event === "tool-result");
    expect(trEvents).toHaveLength(1);
    const tr = JSON.parse(trEvents[0].data);
    expect(tr.is_error).toBe(true);
    expect(tr.content.toLowerCase()).toContain("unknown tool");

    // Should still complete
    expect(events.map((e) => e.event)).toContain("done");
  });

  it("handles confirmation tool (approved)", async () => {
    const sessionId = await createTestSession();

    const toolCallChunks = [
      makeToolCallChunk({
        index: 0,
        callId: "call_ext",
        name: "read_file_external",
        arguments: JSON.stringify({ path: "/etc/hostname" }),
        finishReason: "tool_calls",
      }),
    ];

    const textChunks = [
      makeTextChunk({
        content: "Done.",
        model: "gpt-4o",
        finishReason: "stop",
      }),
    ];

    let callCount = 0;
    createFn = () => {
      callCount++;
      return callCount === 1
        ? mockStream(toolCallChunks)
        : mockStream(textChunks);
    };

    const events = await collectEvents(
      runAgentLoop({
        messages: [
          { role: "user", content: "Read /etc/hostname", tool_calls: null },
        ],
        model: "gpt-4o",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
        requestConfirmation: async () => true,
      }),
    );

    const types = events.map((e) => e.event);
    expect(types).toContain("tool-confirm");
    expect(types).toContain("tool-result");
    expect(types).toContain("done");

    // Result should not be an error (user approved)
    const trEvents = events.filter((e) => e.event === "tool-result");
    const tr = JSON.parse(trEvents[0].data);
    expect(tr.content.toLowerCase()).not.toContain("declined");
  });

  it("handles confirmation tool (denied)", async () => {
    const sessionId = await createTestSession();

    const toolCallChunks = [
      makeToolCallChunk({
        index: 0,
        callId: "call_ext2",
        name: "read_file_external",
        arguments: JSON.stringify({ path: "/etc/shadow" }),
        finishReason: "tool_calls",
      }),
    ];

    const textChunks = [
      makeTextChunk({
        content: "I can't read that file.",
        model: "gpt-4o",
        finishReason: "stop",
      }),
    ];

    let callCount = 0;
    createFn = () => {
      callCount++;
      return callCount === 1
        ? mockStream(toolCallChunks)
        : mockStream(textChunks);
    };

    const events = await collectEvents(
      runAgentLoop({
        messages: [
          { role: "user", content: "Read /etc/shadow", tool_calls: null },
        ],
        model: "gpt-4o",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
        requestConfirmation: async () => false,
      }),
    );

    const types = events.map((e) => e.event);
    expect(types).toContain("tool-confirm");
    expect(types).toContain("tool-result");

    const trEvents = events.filter((e) => e.event === "tool-result");
    const tr = JSON.parse(trEvents[0].data);
    expect(tr.is_error).toBe(true);
    expect(tr.content.toLowerCase()).toContain("declined");
  });

  it("handles streaming tool call arguments across chunks", async () => {
    const sessionId = await createTestSession();

    // Split tool call across multiple chunks
    const toolCallChunks = [
      makeToolCallChunk({
        index: 0,
        callId: "call_split",
        name: "list_directory",
        arguments: '{"pat',
      }),
      makeToolCallChunk({
        index: 0,
        arguments: 'h": "."}',
        finishReason: "tool_calls",
      }),
    ];

    const textChunks = [
      makeTextChunk({
        content: "Files listed.",
        model: "gpt-4o",
        finishReason: "stop",
      }),
    ];

    let callCount = 0;
    createFn = () => {
      callCount++;
      return callCount === 1
        ? mockStream(toolCallChunks)
        : mockStream(textChunks);
    };

    const events = await collectEvents(
      runAgentLoop({
        messages: [{ role: "user", content: "List files", tool_calls: null }],
        model: "gpt-4o",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
      }),
    );

    const tcEvent = events.find((e) => e.event === "tool-call");
    const tc = JSON.parse(tcEvent?.data ?? "{}");
    expect(tc.arguments).toBe('{"path": "."}');
    expect(callCount).toBe(2);
  });

  it("handles OpenAI API errors", async () => {
    const sessionId = await createTestSession();

    createFn = () => {
      throw new Error("API rate limited");
    };

    const events = await collectEvents(
      runAgentLoop({
        messages: [{ role: "user", content: "Hello", tool_calls: null }],
        model: "gpt-4o",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
      }),
    );

    const errors = events.filter((e) => e.event === "error");
    expect(errors).toHaveLength(1);
    const err = JSON.parse(errors[0].data);
    expect(err.message).toContain("API rate limited");
  });

  it("stops when disconnected", async () => {
    const sessionId = await createTestSession();

    // Create a stream that yields many chunks
    const chunks = Array.from({ length: 100 }, (_, i) =>
      makeTextChunk({ content: `word${i} ` }),
    );
    chunks.push(makeTextChunk({ finishReason: "stop" }));

    createFn = () => mockStream(chunks);

    let disconnected = false;
    const events = await collectEvents(
      runAgentLoop({
        messages: [
          { role: "user", content: "Long response", tool_calls: null },
        ],
        model: "gpt-4o",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
        isDisconnected: () => {
          // Disconnect after first chunk
          if (disconnected) return true;
          disconnected = true;
          return false;
        },
      }),
    );

    // Should have very few events since we disconnected early
    expect(events.length).toBeLessThan(10);
    expect(events.map((e) => e.event)).not.toContain("done");
  });

  it("handles Qwen-style text-embedded tool calls (<function=NAME>ARGS</function>)", async () => {
    const sessionId = await createTestSession();

    // Qwen emits the tool call as plain text instead of native function calling
    const qwenTextChunks = [
      makeTextChunk({
        content: '<function=list_directory>{"path": "."}</function>',
        model: "qwen3-coder:30b",
      }),
      makeTextChunk({ finishReason: "stop", model: "qwen3-coder:30b" }),
    ];

    const textChunks = [
      makeTextChunk({
        content: "Here are the files.",
        model: "qwen3-coder:30b",
        finishReason: "stop",
      }),
    ];

    let callCount = 0;
    createFn = () => {
      callCount++;
      return callCount === 1
        ? mockStream(qwenTextChunks)
        : mockStream(textChunks);
    };

    const events = await collectEvents(
      runAgentLoop({
        messages: [{ role: "user", content: "List files", tool_calls: null }],
        model: "qwen3-coder:30b",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
      }),
    );

    const types = events.map((e) => e.event);
    expect(types).toContain("tool-call");
    expect(types).toContain("tool-result");
    expect(types).toContain("done");
    expect(callCount).toBe(2);

    const tcEvent = events.find((e) => e.event === "tool-call");
    const tc = JSON.parse(tcEvent?.data ?? "{}");
    expect(tc.name).toBe("list_directory");
    expect(tc.arguments).toBe('{"path": "."}');
  });

  it("handles Qwen-style <tool_call> JSON format", async () => {
    const sessionId = await createTestSession();

    const qwenTextChunks = [
      makeTextChunk({
        content:
          '<tool_call>{"name":"list_directory","arguments":{"path":"."}}</tool_call>',
        model: "qwen3-coder:30b",
      }),
      makeTextChunk({ finishReason: "stop", model: "qwen3-coder:30b" }),
    ];

    const textChunks = [
      makeTextChunk({
        content: "Done.",
        model: "qwen3-coder:30b",
        finishReason: "stop",
      }),
    ];

    let callCount = 0;
    createFn = () => {
      callCount++;
      return callCount === 1
        ? mockStream(qwenTextChunks)
        : mockStream(textChunks);
    };

    const events = await collectEvents(
      runAgentLoop({
        messages: [{ role: "user", content: "List files", tool_calls: null }],
        model: "qwen3-coder:30b",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
      }),
    );

    const types = events.map((e) => e.event);
    expect(types).toContain("tool-call");
    expect(types).toContain("tool-result");
    expect(types).toContain("done");

    const tcEvent = events.find((e) => e.event === "tool-call");
    const tc = JSON.parse(tcEvent?.data ?? "{}");
    expect(tc.name).toBe("list_directory");
  });

  it("handles Qwen-style text-embedded tool call with empty arguments", async () => {
    const sessionId = await createTestSession();

    // Qwen sometimes emits empty arguments: <function=list_directory> </function>
    const qwenTextChunks = [
      makeTextChunk({
        content: "<function=list_directory> </function>",
        model: "qwen3-coder:30b",
      }),
      makeTextChunk({ finishReason: "stop", model: "qwen3-coder:30b" }),
    ];

    const textChunks = [
      makeTextChunk({
        content: "Done.",
        model: "qwen3-coder:30b",
        finishReason: "stop",
      }),
    ];

    let callCount = 0;
    createFn = () => {
      callCount++;
      return callCount === 1
        ? mockStream(qwenTextChunks)
        : mockStream(textChunks);
    };

    const events = await collectEvents(
      runAgentLoop({
        messages: [{ role: "user", content: "List files", tool_calls: null }],
        model: "qwen3-coder:30b",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
      }),
    );

    const types = events.map((e) => e.event);
    expect(types).toContain("tool-call");
    expect(types).toContain("tool-result");
    expect(types).toContain("done");

    const tcEvent = events.find((e) => e.event === "tool-call");
    const tc = JSON.parse(tcEvent?.data ?? "{}");
    expect(tc.name).toBe("list_directory");
    // Empty args should default to "{}"
    expect(tc.arguments).toBe("{}");
  });

  it("ignores tool call patterns inside <think> blocks (Qwen3 reasoning)", async () => {
    const sessionId = await createTestSession();

    // Qwen3 thinking mode: deliberation mentions a function call in <think> block,
    // but the actual call appears after it.  Only the one outside <think> should fire.
    const qwenTextChunks = [
      makeTextChunk({
        content:
          "<think>I should call list_directory with path .</think>" +
          '<function=list_directory>{"path": "."}</function>',
        model: "qwen3-coder:30b",
      }),
      makeTextChunk({ finishReason: "stop", model: "qwen3-coder:30b" }),
    ];

    const textChunks = [
      makeTextChunk({
        content: "Done.",
        model: "qwen3-coder:30b",
        finishReason: "stop",
      }),
    ];

    let callCount = 0;
    createFn = () => {
      callCount++;
      return callCount === 1
        ? mockStream(qwenTextChunks)
        : mockStream(textChunks);
    };

    const events = await collectEvents(
      runAgentLoop({
        messages: [{ role: "user", content: "List files", tool_calls: null }],
        model: "qwen3-coder:30b",
        ghToken: "gho_fake",
        workDir,
        db: getDb(),
        sessionId,
      }),
    );

    const tcEvents = events.filter((e) => e.event === "tool-call");
    // Exactly one tool call should be detected (not two)
    expect(tcEvents).toHaveLength(1);
    const tc = JSON.parse(tcEvents[0]?.data ?? "{}");
    expect(tc.name).toBe("list_directory");
  });
});
