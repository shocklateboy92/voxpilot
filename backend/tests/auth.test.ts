import { beforeEach, describe, expect, it, mock } from "bun:test";

// ── Mock copilot-auth service ────────────────────────────────────────────────

let _isAuthenticated = false;
let _user: { login: string; name: string | null; avatar_url: string } | null =
  null;

mock.module("../src/services/copilot-auth", () => ({
  startDeviceFlow: async () => ({
    device_code: "mock_device_code",
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    interval: 5,
  }),
  pollDeviceFlow: async (deviceCode: string) => {
    if (deviceCode === "mock_device_code") {
      return { status: "success", access_token: "gho_fake_token_123" };
    }
    return { status: "pending" };
  },
  tokenManager: {
    isAuthenticated: () => _isAuthenticated,
    getUser: () => _user,
    authenticate: async (_token: string) => {
      _isAuthenticated = true;
      _user = {
        login: "testuser",
        name: "Test User",
        avatar_url: "https://example.com/avatar.png",
      };
    },
    logout: async () => {
      _isAuthenticated = false;
      _user = null;
    },
    init: async () => {},
    getJwt: () => ({
      jwt: "mock_jwt",
      baseUrl: "https://api.githubcopilot.com",
    }),
  },
  CopilotTokenManager: class {},
  loadPersistedToken: async () => null,
  persistToken: async () => {},
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

  beforeEach(() => {
    _isAuthenticated = false;
    _user = null;
  });

  it("POST /api/auth/device returns user_code and verification_uri", async () => {
    const res = await app.request("/api/auth/device", { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.user_code).toBe("ABCD-1234");
    expect(data.verification_uri).toBe("https://github.com/login/device");
    expect(data.interval).toBe(5);
  });

  it("GET /api/auth/device/poll authenticates and returns ok", async () => {
    // First start the flow so pendingDeviceCode is set
    await app.request("/api/auth/device", { method: "POST" });

    const res = await app.request("/api/auth/device/poll");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("ok");
  });

  it("GET /api/auth/me returns 401 when not authenticated", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /api/auth/me returns user when authenticated", async () => {
    _isAuthenticated = true;
    _user = {
      login: "testuser",
      name: "Test User",
      avatar_url: "https://example.com/avatar.png",
    };

    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.login).toBe("testuser");
    expect(data.name).toBe("Test User");
    expect(data.avatar_url).toBe("https://example.com/avatar.png");
  });

  it("POST /api/auth/logout clears authentication", async () => {
    _isAuthenticated = true;
    _user = { login: "testuser", name: null, avatar_url: "" };

    const res = await app.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("ok");
    expect(_isAuthenticated).toBe(false);
  });
});
