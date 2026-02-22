import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

export type AuthEnv = {
  Variables: {
    ghToken: string;
  };
};

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getCookie(c, "gh_token");
  if (!token) {
    return c.json({ detail: "Not authenticated" }, 401);
  }
  c.set("ghToken", token);
  await next();
});
