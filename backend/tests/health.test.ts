import { afterEach, describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { setupTestDb } from "./helpers";

// ── Mock global fetch for LLM model probes ───────────────────────────────────

const originalFetch = globalThis.fetch;

function makeMockFetch(models: string[], fail = false) {
  return (url: string | URL | Request) => {
    const urlStr = url instanceof Request ? url.url : String(url);
    if (urlStr.includes("/models")) {
      if (fail) return Promise.reject(new Error("connection refused"));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            object: "list",
            data: models.map((id) => ({ id, object: "model" })),
          }),
          { status: 200 },
        ),
      );
    }
    return originalFetch(url as Parameters<typeof originalFetch>[0]);
  };
}

describe("health", () => {
  setupTestDb();

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("GET /api/health returns status ok with base fields", async () => {
    globalThis.fetch = makeMockFetch(["qwen3-coder:32b"]);

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("ok");
    expect(data.app_name).toBe("VoxPilot");
  });

  it("GET /api/health reports llm connected when LLM server responds", async () => {
    globalThis.fetch = makeMockFetch(["qwen3-coder:32b", "tinyllama"]);

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.llm).toBe("connected");
    expect(data.models).toBe(2);
    expect(typeof data.defaultModel).toBe("string");
  });

  it("GET /api/health reports llm unreachable when LLM server is down", async () => {
    globalThis.fetch = makeMockFetch([], true);

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.llm).toBe("unreachable");
    expect(typeof data.detail).toBe("string");
  });
});
