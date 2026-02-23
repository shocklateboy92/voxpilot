import { Hono } from "hono";
import { config } from "../config";

export const healthRouter = new Hono().get("/api/health", async (c) => {
  const base = { status: "ok", app_name: config.appName };
  try {
    const res = await fetch(`${config.llmBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.llmApiKey}` },
    });
    if (!res.ok) {
      return c.json({ ...base, llm: "error", detail: `HTTP ${res.status}` });
    }
    const json = (await res.json()) as { data: { id: string }[] };
    return c.json({
      ...base,
      llm: "connected",
      models: json.data.length,
      defaultModel: config.llmDefaultModel,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return c.json({ ...base, llm: "unreachable", detail: msg });
  }
});
