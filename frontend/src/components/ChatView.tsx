/**
 * Main chat view — status bar + chat area + agent picker + input + bottom nav with session picker.
 *
 * Renders the NewSessionPage when no session is active (no sessions exist or
 * the user navigated past the newest one). Otherwise renders the normal chat.
 */

import { Show } from "solid-js";
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
  return (
    <main class="app">
      <Show when={!isNewSessionPage()} fallback={<NewSessionPage />}>
        <StatusBar />
        <ChatMain />
        <AgentPicker />
        <ChatInput />
      </Show>
      <BottomNav />
      <SessionPicker />
      <ReviewOverlay />
    </main>
  );
}
