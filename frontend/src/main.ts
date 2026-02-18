import createClient from "openapi-fetch";
import type { components, paths } from "./api.js";
import { streamChat } from "./sse.js";
import type { ChatMessage } from "./sse.js";
import "./style.css";

type GitHubUser = components["schemas"]["GitHubUser"];

// openapi-fetch client for non-streaming endpoints (auth, health)
const client = createClient<paths>({
  baseUrl: window.location.origin,
  credentials: "include",
});

const $ = (sel: string): HTMLElement | null => document.querySelector(sel);

const messages: ChatMessage[] = [];
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

async function checkAuth(): Promise<void> {
  try {
    const { data, error } = await client.GET("/api/auth/me");
    if (error) {
      showLogin();
      return;
    }
    showChat(data);
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
  if (streaming) return;

  messages.push({ role: "user", content });
  appendMessage("user", content);

  const bubble = createStreamingBubble();
  let accumulated = "";

  streaming = true;
  setInputEnabled(false);

  try {
    await streamChat(messages, "gpt-4o", {
      onTextDelta(delta) {
        accumulated += delta;
        bubble.textContent = accumulated;
        const container = $("#messages");
        if (container) container.scrollTop = container.scrollHeight;
      },
      onDone(_model) {
        bubble.classList.remove("streaming");
        messages.push({ role: "assistant", content: accumulated });
      },
      onError(message) {
        bubble.classList.remove("streaming");
        if (accumulated === "") {
          // No content received — turn the bubble into an error
          bubble.className = "message error";
          bubble.textContent = `Error: ${message}`;
        } else {
          // Partial content received — append error below
          appendMessage("error", `Stream error: ${message}`);
        }
      },
    });
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
});
