import { Hono } from "hono";
import { config } from "../config";

export const healthRouter = new Hono();

healthRouter.get("/api/health", (c) => {
  return c.json({ status: "ok", app_name: config.appName });
});
