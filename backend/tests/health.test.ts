import { afterEach, describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { setupTestDb } from "./helpers";

// ── Mock global fetch for Ollama probes ─────────────────────────────────────

const originalFetch = globalThis.fetch;

describe("health", () => {
  setupTestDb();

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("GET /api/health returns status ok with base fields", async () => {
    // Mock fetch to simulate Ollama connected
    globalThis.fetch = (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/tags")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ models: [{ name: "qwen3-coder:32b" }] }),
            {
              status: 200,
            },
          ),
        );
      }
      return originalFetch(url as Parameters<typeof originalFetch>[0]);
    };

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("ok");
    expect(data.app_name).toBe("VoxPilot");
  });

  it("GET /api/health reports llm connected when Ollama responds", async () => {
    globalThis.fetch = (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/tags")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              models: [{ name: "qwen3-coder:32b" }, { name: "tinyllama" }],
            }),
            { status: 200 },
          ),
        );
      }
      return originalFetch(url as Parameters<typeof originalFetch>[0]);
    };

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.llm).toBe("connected");
    expect(data.models).toBe(2);
    expect(typeof data.defaultModel).toBe("string");
  });

  it("GET /api/health reports llm unreachable when Ollama is down", async () => {
    globalThis.fetch = (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/tags")) {
        return Promise.reject(new Error("connection refused"));
      }
      return originalFetch(url as Parameters<typeof originalFetch>[0]);
    };

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.llm).toBe("unreachable");
    expect(typeof data.detail).toBe("string");
  });
});
