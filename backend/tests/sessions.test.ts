import { describe, expect, it, mock } from "bun:test";

mock.module("../src/services/copilot-auth", () => ({
  tokenManager: {
    isAuthenticated: () => true,
    getUser: () => null,
    authenticate: async () => {},
    logout: async () => {},
    init: async () => {},
    getJwt: () => ({
      jwt: "mock_jwt",
      baseUrl: "https://api.githubcopilot.com",
    }),
  },
  CopilotTokenManager: class {},
  loadPersistedToken: async () => null,
  persistToken: async () => {},
  startDeviceFlow: async () => ({}),
  pollDeviceFlow: async () => ({ status: "pending" }),
  getGithubUser: async () => ({
    login: "testuser",
    name: null,
    avatar_url: "",
  }),
}));

import { getDb } from "../src/db";
import { app } from "../src/index";
import { addMessage, getMessages } from "../src/services/sessions";
import { setupTestDb } from "./helpers";

const AUTH = { headers: {} };

describe("sessions", () => {
  setupTestDb();

  it("GET /api/sessions returns empty list initially", async () => {
    const res = await app.request("/api/sessions", AUTH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST /api/sessions returns 201 with id, empty title, timestamps", async () => {
    const res = await app.request("/api/sessions", {
      method: "POST",
      ...AUTH,
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.id).toBeDefined();
    expect(data.title).toBe("");
    expect(data.created_at).toBeDefined();
    expect(data.updated_at).toBeDefined();
  });

  it("list sessions returns created sessions", async () => {
    await app.request("/api/sessions", { method: "POST", ...AUTH });
    await app.request("/api/sessions", { method: "POST", ...AUTH });

    const res = await app.request("/api/sessions", AUTH);
    expect(res.status).toBe(200);
    const sessions = (await res.json()) as unknown[];
    expect(sessions.length).toBe(2);
  });

  it("GET /api/sessions/:id returns session with empty messages", async () => {
    const createRes = await app.request("/api/sessions", {
      method: "POST",
      ...AUTH,
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/sessions/${created.id}`, AUTH);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { id: string; messages: unknown[] };
    expect(data.id).toBe(created.id);
    expect(data.messages).toEqual([]);
  });

  it("GET /api/sessions/:id returns 404 for unknown id", async () => {
    const res = await app.request("/api/sessions/nonexistent-id", AUTH);
    expect(res.status).toBe(404);
  });

  it("DELETE /api/sessions/:id removes the session", async () => {
    const createRes = await app.request("/api/sessions", {
      method: "POST",
      ...AUTH,
    });
    const created = (await createRes.json()) as { id: string };

    const deleteRes = await app.request(`/api/sessions/${created.id}`, {
      method: "DELETE",
      ...AUTH,
    });
    expect(deleteRes.status).toBe(204);

    const getRes = await app.request(`/api/sessions/${created.id}`, AUTH);
    expect(getRes.status).toBe(404);
  });

  it("DELETE /api/sessions/:id returns 404 for unknown id", async () => {
    const res = await app.request("/api/sessions/nonexistent-id", {
      method: "DELETE",
      ...AUTH,
    });
    expect(res.status).toBe(404);
  });

  it("PATCH /api/sessions/:id updates the title", async () => {
    const createRes = await app.request("/api/sessions", {
      method: "POST",
      ...AUTH,
    });
    const created = (await createRes.json()) as { id: string };

    const patchRes = await app.request(`/api/sessions/${created.id}`, {
      method: "PATCH",
      headers: {
        ...AUTH.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "My chat" }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { title: string };
    expect(patched.title).toBe("My chat");

    // Verify via GET
    const getRes = await app.request(`/api/sessions/${created.id}`, AUTH);
    const session = (await getRes.json()) as { title: string };
    expect(session.title).toBe("My chat");
  });

  it("PATCH /api/sessions/:id returns 404 for unknown id", async () => {
    const res = await app.request("/api/sessions/nonexistent-id", {
      method: "PATCH",
      headers: {
        ...AUTH.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("session endpoints return 200/201 when authenticated", async () => {
    // Auth is controlled by tokenManager.isAuthenticated() (mocked to true)
    expect((await app.request("/api/sessions")).status).toBe(200);
    expect(
      (await app.request("/api/sessions", { method: "POST" })).status,
    ).toBe(201);
  });

  it("cascade delete removes messages", async () => {
    const db = getDb();

    // Create session and add a message via the service layer
    const createRes = await app.request("/api/sessions", {
      method: "POST",
      ...AUTH,
    });
    const created = (await createRes.json()) as { id: string };

    await addMessage(db, created.id, "user", "hello");
    const msgs = await getMessages(db, created.id);
    expect(msgs.length).toBe(1);

    // Delete session
    const deleteRes = await app.request(`/api/sessions/${created.id}`, {
      method: "DELETE",
      ...AUTH,
    });
    expect(deleteRes.status).toBe(204);

    // Verify messages are gone
    const remaining = await getMessages(db, created.id);
    expect(remaining.length).toBe(0);
  });
});
