/**
 * Bottom navigation bar — session title (tap to open picker) and + button.
 */

import { activeSession, setPickerOpen } from "../store";
import { handleNewSession } from "../sessions";

export function BottomNav() {
  return (
    <nav id="bottom-nav">
      <button
        id="session-title-btn"
        onClick={() => setPickerOpen(true)}
      >
        {activeSession()?.title || "New chat"}
      </button>
      <button
        id="new-chat-btn"
        onClick={() => void handleNewSession()}
        title="New chat"
      >
        +
      </button>
    </nav>
  );
}
