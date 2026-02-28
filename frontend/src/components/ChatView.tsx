/**
 * Main chat view — status bar + chat area + agent picker + input + bottom nav with session picker.
 *
 * Renders the NewSessionPage when no session is active (no sessions exist or
 * the user navigated past the newest one). Otherwise renders the normal chat.
 */

import { onMount, Show } from "solid-js";
import { initSessions } from "../sessions";
import { isNewSessionPage } from "../store";
import { AgentPicker } from "./AgentPicker";
import { BottomNav } from "./BottomNav";
import { ChatInput } from "./ChatInput";
import { ChatMain } from "./ChatMain";
import { NewSessionPage } from "./NewSessionPage";
import { ReviewOverlay } from "./ReviewOverlay";
import { SessionPicker } from "./SessionPicker";
import { StatusBar } from "./StatusBar";

export function ChatView() {
  onMount(() => {
    void initSessions();
  });

  return (
    <main class="app">
      <Show when={isNewSessionPage()} fallback={
        <>
          <StatusBar />
          <ChatMain />
          <AgentPicker />
          <ChatInput />
        </>
      }>
        <NewSessionPage />
      </Show>
      <BottomNav />
      <SessionPicker />
      <ReviewOverlay />
    </main>
  );
}
