/**
 * Main chat view — chat area + bottom nav with session picker.
 */

import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { initSessions } from "../sessions";
import { ChatMain } from "./ChatMain";
import { BottomNav } from "./BottomNav";
import { SessionPicker } from "./SessionPicker";
import { ReviewOverlay } from "./ReviewOverlay";
import { ContextUsageBar } from "./ContextUsageBar";

interface LlmHealth {
  llm?: string;
  defaultModel?: string;
  detail?: string;
}

function LlmHealthIndicator() {
  const [health, setHealth] = createSignal<LlmHealth | null>(null);

  const pollHealth = async () => {
    try {
      const res = await fetch("/api/health");
      const data = (await res.json()) as LlmHealth;
      setHealth(data);
    } catch {
      setHealth({ llm: "unreachable" });
    }
  };

  onMount(() => {
    void pollHealth();
    const id = setInterval(() => void pollHealth(), 30_000);
    onCleanup(() => clearInterval(id));
  });

  return (
    <div id="user-info">
      <Show
        when={health()?.llm === "connected"}
        fallback={<span class="health-dot health-dot-red" />}
      >
        <span class="health-dot health-dot-green" />
      </Show>
      <span id="user-name">
        {health()?.llm === "connected"
          ? (health()?.defaultModel ?? "Connected")
          : "LLM offline"}
      </span>
      <ContextUsageBar />
    </div>
  );
}

export function ChatView() {
  onMount(() => {
    void initSessions();
  });

  return (
    <main id="app">
      <LlmHealthIndicator />
      <ChatMain />
      <BottomNav />
      <SessionPicker />
      <ReviewOverlay />
    </main>
  );
}
