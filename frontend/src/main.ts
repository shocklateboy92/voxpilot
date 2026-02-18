import "./style.css";

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

interface ChatResponse {
  message: string;
  model: string;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const $ = (sel: string): HTMLElement | null => document.querySelector(sel);

const API_BASE = window.location.origin;
const messages: ChatMessage[] = [];

function show(id: string): void {
  $(id)?.classList.remove("hidden");
}

function hide(id: string): void {
  $(id)?.classList.add("hidden");
}

function appendMessage(role: "user" | "assistant" | "error", content: string): void {
  const container = $("#messages");
  if (!container) return;
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.textContent = content;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function checkAuth(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
    if (!res.ok) {
      showLogin();
      return;
    }
    const user: GitHubUser = (await res.json()) as GitHubUser;
    showChat(user);
  } catch {
    showLogin();
  }
}

function showLogin(): void {
  hide("#status");
  hide("#chat-view");
  show("#login-view");
}

function showChat(user: GitHubUser): void {
  hide("#status");
  hide("#login-view");
  show("#chat-view");

  const avatar = $("#user-avatar") as HTMLImageElement | null;
  const name = $("#user-name");
  if (avatar) avatar.src = user.avatar_url;
  if (name) name.textContent = user.name ?? user.login;
}

async function sendMessage(content: string): Promise<void> {
  messages.push({ role: "user", content });
  appendMessage("user", content);

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, model: "gpt-4o" }),
    });

    if (!res.ok) {
      const text = await res.text();
      appendMessage("error", `Error: ${res.status.toString()} ${text}`);
      return;
    }

    const data: ChatResponse = (await res.json()) as ChatResponse;
    messages.push({ role: "assistant", content: data.message });
    appendMessage("assistant", data.message);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    appendMessage("error", `Network error: ${msg}`);
  }
}

async function handleLogout(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
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
});
