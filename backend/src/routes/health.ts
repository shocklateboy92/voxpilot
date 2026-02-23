import OpenAI from "openai";
import { Hono } from "hono";
import { config } from "../config";

export const healthRouter = new Hono().get("/api/health", async (c) => {
  const base = { status: "ok", app_name: config.appName };
  try {
    const openai = new OpenAI({
      baseURL: config.llmBaseUrl,
      apiKey: config.llmApiKey,
    });
    const modelsPage = await openai.models.list();
    return c.json({
      ...base,
      llm: "connected",
      models: modelsPage.data.length,
      defaultModel: config.llmDefaultModel,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return c.json({ ...base, llm: "unreachable", detail: msg });
  }
});
