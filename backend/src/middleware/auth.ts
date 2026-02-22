import { createMiddleware } from "hono/factory";
import { tokenManager } from "../services/copilot-auth";

export type AuthEnv = {
  Variables: Record<string, never>;
};

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  if (!tokenManager.isAuthenticated()) {
    return c.json({ detail: "Not authenticated" }, 401);
  }
  await next();
});
