import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { config } from "../config";
import { authMiddleware, type AuthEnv } from "../middleware/auth";
import {
  generateState,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  getGithubUser,
} from "../services/github";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const STATE_COOKIE_MAX_AGE = 60 * 10; // 10 minutes

export const authRouter = new Hono<AuthEnv>();

authRouter.get("/api/auth/login", (c) => {
  const state = generateState();
  setCookie(c, "oauth_state", state, {
    httpOnly: true,
    sameSite: "Lax",
    maxAge: STATE_COOKIE_MAX_AGE,
  });
  const url = buildAuthorizationUrl(config.githubClientId, state);
  return c.redirect(url, 302);
});

authRouter.get("/api/auth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c, "oauth_state");

  if (!code || !state) {
    return c.json({ detail: "Missing code or state" }, 400);
  }

  if (storedState && state !== storedState) {
    return c.json({ detail: "State mismatch" }, 400);
  }

  const token = await exchangeCodeForToken(
    config.githubClientId,
    config.githubClientSecret,
    code,
  );

  setCookie(c, "gh_token", token, {
    httpOnly: true,
    sameSite: "Lax",
    maxAge: COOKIE_MAX_AGE,
  });
  deleteCookie(c, "oauth_state");

  return c.redirect("/", 302);
});

authRouter.post("/api/auth/logout", (c) => {
  deleteCookie(c, "gh_token");
  return c.json({ status: "ok" });
});

authRouter.get("/api/auth/me", authMiddleware, async (c) => {
  const token = c.get("ghToken");
  try {
    const user = await getGithubUser(token);
    return c.json(user);
  } catch {
    return c.json({ detail: "Invalid or expired token" }, 401);
  }
});
