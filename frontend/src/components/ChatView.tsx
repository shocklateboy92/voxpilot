/**
 * Main chat view — status bar + chat area + input + bottom nav with session picker.
 */

import { onMount } from "solid-js";
import { initSessions } from "../sessions";
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
    <main id="app">
      <StatusBar />
      <ChatMain />
      <ChatInput />
      <BottomNav />
      <SessionPicker />
      <ReviewOverlay />
    </main>
  );
}
