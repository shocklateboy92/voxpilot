import createClient from "openapi-fetch";
import type { components, paths } from "./api.js";
import { streamChat } from "./sse.js";
import "./style.css";

type GitHubUser = components["schemas"]["GitHubUser"];

interface SessionSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRead {
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

interface SessionDetail {
  id: string;
  title: string;
  messages: MessageRead[];
  created_at: string;
  updated_at: string;
}

// openapi-fetch client for non-streaming endpoints (auth, health)
const client = createClient<paths>({
  baseUrl: window.location.origin,
  credentials: "include",
});

const $ = (sel: string): HTMLElement | null => document.querySelector(sel);

let currentSessionId: string | null = null;
let streaming = false;

function show(id: string): void {
  $(id)?.classList.remove("hidden");
}

function hide(id: string): void {
  $(id)?.classList.add("hidden");
}

/** Append a completed message bubble to the chat. */
function appendMessage(role: "user" | "assistant" | "error", content: string): HTMLElement {
  const container = $("#messages");
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.textContent = content;
  container?.appendChild(div);
  if (container) container.scrollTop = container.scrollHeight;
  return div;
}

/** Create an empty assistant bubble with a streaming cursor. */
function createStreamingBubble(): HTMLElement {
  const container = $("#messages");
  const div = document.createElement("div");
  div.className = "message assistant streaming";
  container?.appendChild(div);
  if (container) container.scrollTop = container.scrollHeight;
  return div;
}

function setInputEnabled(enabled: boolean): void {
  const input = $("#chat-input") as HTMLInputElement | null;
  const btn = $("#chat-form")?.querySelector("button[type=submit]") as HTMLButtonElement | null;
  if (input) input.disabled = !enabled;
  if (btn) btn.disabled = !enabled;
}

function clearMessages(): void {
  const container = $("#messages");
  if (container) container.innerHTML = "";
}

// ── Session API helpers ───────────────────────────────────────────────────────

async function fetchSessions(): Promise<SessionSummary[]> {
  const res = await fetch("/api/sessions", { credentials: "include" });
  if (!res.ok) return [];
  return (await res.json()) as SessionSummary[];
}

async function createSession(): Promise<SessionSummary> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    credentials: "include",
  });
  return (await res.json()) as SessionSummary;
}

async function fetchSession(id: string): Promise<SessionDetail> {
  const res = await fetch(`/api/sessions/${id}`, { credentials: "include" });
  return (await res.json()) as SessionDetail;
}

async function deleteSessionApi(id: string): Promise<void> {
  await fetch(`/api/sessions/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
}

// ── Session sidebar ──────────────────────────────────────────────────────────

function renderSessionList(sessions: SessionSummary[]): void {
  const list = $("#session-list");
  if (!list) return;
  list.innerHTML = "";

  for (const session of sessions) {
    const item = document.createElement("div");
    item.className = `session-item${session.id === currentSessionId ? " active" : ""}`;
    item.dataset.id = session.id;

    const titleSpan = document.createElement("span");
    titleSpan.className = "session-title";
    titleSpan.textContent = session.title || "New chat";
    titleSpan.addEventListener("click", () => void switchSession(session.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "session-delete";
    deleteBtn.textContent = "×";
    deleteBtn.title = "Delete session";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void handleDeleteSession(session.id);
    });

    item.appendChild(titleSpan);
    item.appendChild(deleteBtn);
    list.appendChild(item);
  }
}

async function switchSession(sessionId: string): Promise<void> {
  currentSessionId = sessionId;
  clearMessages();

  const detail = await fetchSession(sessionId);
  for (const msg of detail.messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      appendMessage(msg.role, msg.content);
    }
  }

  // Update active state in sidebar
  document.querySelectorAll(".session-item").forEach((el) => {
    el.classList.toggle("active", (el as HTMLElement).dataset.id === sessionId);
  });
}

async function handleNewSession(): Promise<void> {
  const session = await createSession();
  currentSessionId = session.id;
  clearMessages();
  const sessions = await fetchSessions();
  renderSessionList(sessions);
}

async function handleDeleteSession(sessionId: string): Promise<void> {
  await deleteSessionApi(sessionId);
  const sessions = await fetchSessions();

  if (sessionId === currentSessionId) {
    const first = sessions[0];
    if (first) {
      await switchSession(first.id);
    } else {
      // Create a new session if all were deleted
      const fresh = await createSession();
      sessions.push(fresh);
      currentSessionId = fresh.id;
      clearMessages();
    }
  }

  renderSessionList(sessions);
}

// ── Auth & app boot ──────────────────────────────────────────────────────────

async function checkAuth(): Promise<void> {
  try {
    const { data, error } = await client.GET("/api/auth/me");
    if (error) {
      showLogin();
      return;
    }
    await showChat(data);
  } catch {
    showLogin();
  }
}

function showLogin(): void {
  hide("#status");
  hide("#chat-view");
  show("#login-view");
}

async function showChat(user: GitHubUser): Promise<void> {
  hide("#status");
  hide("#login-view");
  show("#chat-view");

  const avatar = $("#user-avatar") as HTMLImageElement | null;
  const name = $("#user-name");
  if (avatar) avatar.src = user.avatar_url;
  if (name) name.textContent = user.name ?? user.login;

  // Load sessions
  let sessions = await fetchSessions();
  if (sessions.length === 0) {
    const fresh = await createSession();
    sessions = [fresh];
  }
  const first = sessions[0];
  if (first) {
    currentSessionId = first.id;
    renderSessionList(sessions);
    await switchSession(first.id);
  }
}

async function sendMessage(content: string): Promise<void> {
  if (streaming || !currentSessionId) return;

  appendMessage("user", content);

  const bubble = createStreamingBubble();
  let accumulated = "";

  streaming = true;
  setInputEnabled(false);

  try {
    await streamChat(currentSessionId, content, "gpt-4o", {
      onTextDelta(delta) {
        accumulated += delta;
        bubble.textContent = accumulated;
        const container = $("#messages");
        if (container) container.scrollTop = container.scrollHeight;
      },
      onDone(_model) {
        bubble.classList.remove("streaming");
      },
      onError(message) {
        bubble.classList.remove("streaming");
        if (accumulated === "") {
          bubble.className = "message error";
          bubble.textContent = `Error: ${message}`;
        } else {
          appendMessage("error", `Stream error: ${message}`);
        }
      },
    });

    // Refresh session list (title may have been set by auto-title)
    const sessions = await fetchSessions();
    renderSessionList(sessions);
  } catch (err: unknown) {
    bubble.classList.remove("streaming");
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (accumulated === "") {
      bubble.className = "message error";
      bubble.textContent = `Network error: ${msg}`;
    } else {
      appendMessage("error", `Network error: ${msg}`);
    }
  } finally {
    streaming = false;
    setInputEnabled(true);
    ($("#chat-input") as HTMLInputElement | null)?.focus();
  }
}

async function handleLogout(): Promise<void> {
  await client.POST("/api/auth/logout");
  window.location.reload();
}

document.addEventListener("DOMContentLoaded", () => {
  void checkAuth();

  const form = $("#chat-form") as HTMLFormElement | null;
  const input = $("#chat-input") as HTMLInputElement | null;

  form?.addEventListener("submit", (e: Event) => {
    e.preventDefault();
    const value = input?.value.trim();
    if (!value) return;
    if (input) input.value = "";
    void sendMessage(value);
  });

  $("#logout-btn")?.addEventListener("click", () => {
    void handleLogout();
  });

  $("#new-session-btn")?.addEventListener("click", () => {
    void handleNewSession();
  });
});
