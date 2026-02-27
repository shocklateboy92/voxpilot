/**
 * Main chat view — status bar + chat area + agent picker + input + bottom nav with session picker.
 */

import { onMount } from "solid-js";
import { initSessions } from "../sessions";
import { AgentPicker } from "./AgentPicker";
import { BottomNav } from "./BottomNav";
import { ChatInput } from "./ChatInput";
import { ChatMain } from "./ChatMain";
import { ReviewOverlay } from "./ReviewOverlay";
import { SessionPicker } from "./SessionPicker";
import { StatusBar } from "./StatusBar";

export function ChatView() {
  onMount(() => {
    void initSessions();
  });

  return (
    <main class="app">
      <StatusBar />
      <ChatMain />
      <AgentPicker />
      <ChatInput />
      <BottomNav />
      <SessionPicker />
      <ReviewOverlay />
    </main>
  );
}
