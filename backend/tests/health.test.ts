import { describe, expect, it, mock } from "bun:test";
import { setupTestDb } from "./helpers";

// ── Mock OpenAI ─────────────────────────────────────────────────────────────

let listFn: () => unknown;

mock.module("openai", () => ({
  default: class MockOpenAI {
    static APIError = class extends Error {};
    chat = {
      completions: {
        create: () => {
          throw new Error("not used in health tests");
        },
      },
    };
    models = {
      list: () => listFn(),
    };
  },
}));

// Re-import app after mock is installed
const { app } = await import("../src/index");

describe("health", () => {
  setupTestDb();

  it("GET /api/health returns status ok with base fields", async () => {
    listFn = () => Promise.resolve({ data: [{ id: "qwen3-coder:32b" }] });

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("ok");
    expect(data.app_name).toBe("VoxPilot");
  });

  it("GET /api/health reports llm connected when LLM server responds", async () => {
    listFn = () =>
      Promise.resolve({
        data: [{ id: "qwen3-coder:32b" }, { id: "tinyllama" }],
      });

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.llm).toBe("connected");
    expect(data.models).toBe(2);
    expect(typeof data.defaultModel).toBe("string");
  });

  it("GET /api/health reports llm unreachable when LLM server is down", async () => {
    listFn = () => Promise.reject(new Error("connection refused"));

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.llm).toBe("unreachable");
    expect(typeof data.detail).toBe("string");
  });
});
