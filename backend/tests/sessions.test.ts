import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { setupTestDb } from "./helpers";
import { addMessage, getMessages } from "../src/services/sessions";
import { getDb } from "../src/db";

const AUTH = { headers: { Cookie: "gh_token=gho_fake" } };

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

  it("session endpoints return 401 without cookie", async () => {
    expect(
      (await app.request("/api/sessions")).status,
    ).toBe(401);
    expect(
      (await app.request("/api/sessions", { method: "POST" })).status,
    ).toBe(401);
    expect(
      (await app.request("/api/sessions/some-id")).status,
    ).toBe(401);
    expect(
      (await app.request("/api/sessions/some-id", { method: "DELETE" })).status,
    ).toBe(401);
    expect(
      (
        await app.request("/api/sessions/some-id", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "x" }),
        })
      ).status,
    ).toBe(401);
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
