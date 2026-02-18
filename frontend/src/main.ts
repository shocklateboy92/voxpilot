import createClient from "openapi-fetch";
import type { components, paths } from "./api.js";
import { connectSession, sendMessage as postMessage } from "./sse.js";
import type { ToolCallPayload, ToolResultPayload, MessagePayload } from "./sse.js";
import "./style.css";

type GitHubUser = components["schemas"]["GitHubUser"];

interface SessionSummary {
  id: string;
  title: string;
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
let activeStream: EventSource | null = null;

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

/** Render a tool call as a collapsible block. */
function appendToolCall(payload: ToolCallPayload): HTMLElement {
  const container = $("#messages");
  const details = document.createElement("details");
  details.className = "tool-block";
  details.dataset.toolCallId = payload.id;

  const summary = document.createElement("summary");
  summary.className = "tool-summary";
  summary.textContent = `⚙ ${payload.name}`;
  details.appendChild(summary);

  // Show arguments
  const argsDiv = document.createElement("div");
  argsDiv.className = "tool-arguments";
  try {
    const parsed = JSON.parse(payload.arguments);
    argsDiv.textContent = JSON.stringify(parsed, null, 2);
  } catch {
    argsDiv.textContent = payload.arguments;
  }
  details.appendChild(argsDiv);

  container?.appendChild(details);
  if (container) container.scrollTop = container.scrollHeight;
  return details;
}

/** Append a tool result inside the tool block or as a new block. */
function appendToolResult(payload: ToolResultPayload): void {
  const container = $("#messages");
  // Find the matching tool-call block
  const block = container?.querySelector(
    `details.tool-block[data-tool-call-id="${payload.id}"]`,
  ) as HTMLDetailsElement | null;

  const resultDiv = document.createElement("div");
  resultDiv.className = `tool-result${payload.is_error ? " tool-error" : ""}`;

  const pre = document.createElement("pre");
  pre.textContent = payload.content;
  resultDiv.appendChild(pre);

  if (block) {
    block.appendChild(resultDiv);
  } else {
    // Fallback: append directly
    container?.appendChild(resultDiv);
  }
  if (container) container.scrollTop = container.scrollHeight;
}

/** Render a tool call from history replay (combined call + result). */
function appendToolCallFromHistory(payload: MessagePayload): void {
  if (payload.tool_calls) {
    for (const tc of payload.tool_calls) {
      appendToolCall({ id: tc.id, name: tc.name, arguments: tc.arguments });
    }
  }
}

/** Render a tool result from history replay. */
function appendToolResultFromHistory(payload: MessagePayload): void {
  if (payload.tool_call_id) {
    appendToolResult({
      id: payload.tool_call_id,
      name: "", // name not stored on tool result messages
      content: payload.content,
      is_error: payload.content.startsWith("Error:"),
    });
  }
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
  // Close any existing stream
  if (activeStream) {
    activeStream.close();
    activeStream = null;
  }

  currentSessionId = sessionId;
  clearMessages();
  setInputEnabled(false);

  let currentBubble: HTMLElement | null = null;
  let accumulated = "";

  activeStream = connectSession(sessionId, {
    onMessage(payload) {
      if (payload.role === "user") {
        appendMessage("user", payload.content);
      } else if (payload.role === "assistant") {
        if (payload.tool_calls && payload.tool_calls.length > 0) {
          // Assistant message that invoked tools — render tool calls
          if (payload.content) {
            appendMessage("assistant", payload.content);
          }
          appendToolCallFromHistory(payload);
        } else {
          appendMessage("assistant", payload.content);
        }
      } else if (payload.role === "tool") {
        appendToolResultFromHistory(payload);
      }
    },
    onReady() {
      // History replay complete — enable input and scroll to bottom
      setInputEnabled(true);
      const container = $("#messages");
      if (container) container.scrollTop = container.scrollHeight;
    },
    onTextDelta(content) {
      if (!currentBubble) {
        currentBubble = createStreamingBubble();
        accumulated = "";
      }
      accumulated += content;
      currentBubble.textContent = accumulated;
      const container = $("#messages");
      if (container) container.scrollTop = container.scrollHeight;
    },
    onToolCall(payload) {
      // Finalize any in-progress streaming bubble before showing tool call
      if (currentBubble) {
        currentBubble.classList.remove("streaming");
        currentBubble = null;
        accumulated = "";
      }
      appendToolCall(payload);
    },
    onToolResult(payload) {
      appendToolResult(payload);
    },
    onDone(_model) {
      if (currentBubble) {
        currentBubble.classList.remove("streaming");
        currentBubble = null;
        accumulated = "";
      }
      streaming = false;
      setInputEnabled(true);
      ($("#chat-input") as HTMLInputElement | null)?.focus();

      // Refresh session list (title may have been set by auto-title)
      void fetchSessions().then(renderSessionList);
    },
    onError(message) {
      if (currentBubble) {
        currentBubble.classList.remove("streaming");
        if (accumulated === "") {
          currentBubble.className = "message error";
          currentBubble.textContent = `Error: ${message}`;
        } else {
          appendMessage("error", `Stream error: ${message}`);
        }
        currentBubble = null;
        accumulated = "";
      } else {
        appendMessage("error", `Error: ${message}`);
      }
      streaming = false;
      setInputEnabled(true);
    },
  });

  // Update active state in sidebar
  document.querySelectorAll(".session-item").forEach((el) => {
    el.classList.toggle("active", (el as HTMLElement).dataset.id === sessionId);
  });
}

async function handleNewSession(): Promise<void> {
  const session = await createSession();
  const sessions = await fetchSessions();
  renderSessionList(sessions);
  await switchSession(session.id);
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

  streaming = true;
  setInputEnabled(false);

  try {
    const response = await postMessage(currentSessionId, content);
    if (!response.ok && response.status !== 202) {
      const text = await response.text();
      appendMessage("error", `Failed to send: HTTP ${response.status} — ${text}`);
      streaming = false;
      setInputEnabled(true);
    }
    // On 202, the stream will deliver the echoed user message + assistant response
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    appendMessage("error", `Network error: ${msg}`);
    streaming = false;
    setInputEnabled(true);
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
