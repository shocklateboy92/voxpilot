import { Hono } from "hono";
import { config } from "../config";

export const healthRouter = new Hono().get("/api/health", async (c) => {
  const base = { status: "ok", app_name: config.appName };
  try {
    const ollamaBase = config.llmBaseUrl.replace(/\/v1\/?$/, "");
    const res = await fetch(`${ollamaBase}/api/tags`);
    if (!res.ok) {
      return c.json({ ...base, llm: "error", detail: `HTTP ${res.status}` });
    }
    const data: unknown = await res.json();
    const models = Array.isArray((data as Record<string, unknown>)?.["models"])
      ? ((data as Record<string, unknown>)["models"] as Array<unknown>).length
      : 0;
    return c.json({
      ...base,
      llm: "connected",
      models,
      defaultModel: config.llmDefaultModel,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return c.json({ ...base, llm: "unreachable", detail: msg });
  }
});
