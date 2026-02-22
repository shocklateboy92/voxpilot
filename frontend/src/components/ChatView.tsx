/**
 * Main chat view — chat area + bottom nav with session picker.
 */

import { onMount, onCleanup, createSignal } from "solid-js";
import { initSessions } from "../sessions";
import { fetchHealth } from "../api-client";
import { ChatMain } from "./ChatMain";
import { BottomNav } from "./BottomNav";
import { SessionPicker } from "./SessionPicker";
import { ReviewOverlay } from "./ReviewOverlay";

const HEALTH_POLL_MS = 30_000;

interface HealthStatus {
  llm: string;
  defaultModel?: string;
}

export function ChatView() {
  const [health, setHealth] = createSignal<HealthStatus | null>(null);

  const pollHealth = async () => {
    try {
      const data = await fetchHealth();
      setHealth({ llm: data.llm ?? "unknown", defaultModel: data.defaultModel });
    } catch {
      setHealth({ llm: "unreachable" });
    }
  };

  onMount(() => {
    void initSessions();
    void pollHealth();
  });

  const interval = setInterval(() => void pollHealth(), HEALTH_POLL_MS);
  onCleanup(() => clearInterval(interval));

  const statusDot = () => {
    const h = health();
    if (!h) return "⏳";
    return h.llm === "connected" ? "🟢" : "🔴";
  };

  const statusText = () => {
    const h = health();
    if (!h) return "Checking…";
    if (h.llm === "connected") return h.defaultModel ?? "Connected";
    return "LLM offline";
  };

  return (
    <main id="app">
      <div id="status-bar">
        <span class="status-dot">{statusDot()}</span>
        <span class="status-label">{statusText()}</span>
      </div>
      <ChatMain />
      <BottomNav />
      <SessionPicker />
      <ReviewOverlay />
    </main>
  );
}
