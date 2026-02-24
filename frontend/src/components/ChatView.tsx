/**
 * Main chat view — chat area + bottom nav with session picker.
 */

import { onMount } from "solid-js";
import { initSessions } from "../sessions";
import { BottomNav } from "./BottomNav";
import { ChatMain } from "./ChatMain";
import { ReviewOverlay } from "./ReviewOverlay";
import { SessionPicker } from "./SessionPicker";

export function ChatView() {
  onMount(() => {
    void initSessions();
  });

  return (
    <main id="app">
      <ChatMain />
      <BottomNav />
      <SessionPicker />
      <ReviewOverlay />
    </main>
  );
}
