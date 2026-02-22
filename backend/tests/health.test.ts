import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { setupTestDb } from "./helpers";

describe("health", () => {
  setupTestDb();

  it("GET /api/health returns status ok with llm field", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.app_name).toBe("VoxPilot");
    // LLM will be "unreachable" in test env (no Ollama running)
    expect(["connected", "error", "unreachable"]).toContain(data.llm);
  });
});
