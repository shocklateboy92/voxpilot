import createClient from "openapi-fetch";
import type { components, paths } from "./api.js";
import "./style.css";

type GitHubUser = components["schemas"]["GitHubUser"];
type ChatMessage = components["schemas"]["ChatMessage"];

const client = createClient<paths>({
  baseUrl: window.location.origin,
  credentials: "include",
});

const $ = (sel: string): HTMLElement | null => document.querySelector(sel);

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
  messages.push({ role: "user", content });
  appendMessage("user", content);

  try {
    const { data, error } = await client.POST("/api/chat", {
      body: { messages, model: "gpt-4o" },
    });

    if (error) {
      appendMessage("error", `Error: ${JSON.stringify(error)}`);
      return;
    }

    messages.push({ role: "assistant", content: data.message });
    appendMessage("assistant", data.message);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    appendMessage("error", `Network error: ${msg}`);
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
