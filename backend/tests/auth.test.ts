import { mock, describe, expect, it } from "bun:test";

mock.module("../src/services/github", () => ({
  generateState: () => "mock_state_abc123",
  buildAuthorizationUrl: (clientId: string, state: string) =>
    `https://github.com/login/oauth/authorize?client_id=${clientId}&state=${state}`,
  exchangeCodeForToken: async () => "gho_fake_token_123",
  getGithubUser: async () => ({
    login: "testuser",
    name: "Test User",
    avatar_url: "https://example.com/avatar.png",
  }),
}));

import { app } from "../src/index";
import { setupTestDb } from "./helpers";

describe("auth", () => {
  setupTestDb();

  it("GET /api/auth/login redirects to GitHub", async () => {
    const res = await app.request("/api/auth/login", { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("github.com/login/oauth/authorize");
  });

  it("GET /api/auth/callback sets cookie and redirects", async () => {
    const res = await app.request(
      "/api/auth/callback?code=test_code&state=mock_state_abc123",
      {
        headers: { Cookie: "oauth_state=mock_state_abc123" },
        redirect: "manual",
      },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toBe("/");
    const setCookies = res.headers.getAll("Set-Cookie");
    const ghTokenCookie = setCookies.find((c: string) =>
      c.startsWith("gh_token="),
    );
    expect(ghTokenCookie).toBeDefined();
    expect(ghTokenCookie).toContain("gho_fake_token_123");
  });

  it("GET /api/auth/me returns 401 without cookie", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /api/auth/me returns user with valid cookie", async () => {
    const res = await app.request("/api/auth/me", {
      headers: { Cookie: "gh_token=fake_token" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.login).toBe("testuser");
    expect(data.name).toBe("Test User");
    expect(data.avatar_url).toBe("https://example.com/avatar.png");
  });

  it("POST /api/auth/logout clears cookie", async () => {
    const res = await app.request("/api/auth/logout", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    const setCookies = res.headers.getAll("Set-Cookie");
    const ghTokenCookie = setCookies.find((c: string) =>
      c.startsWith("gh_token="),
    );
    expect(ghTokenCookie).toBeDefined();
    // Cookie deletion sets Max-Age=0
    expect(ghTokenCookie).toContain("Max-Age=0");
  });
});
