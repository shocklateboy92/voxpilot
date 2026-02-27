/**
 * Bottom navigation bar — session title (tap to open picker) and + button.
 */

import { handleNewSession } from "../sessions";
import { activeSession, setPickerOpen } from "../store";

export function BottomNav() {
  return (
    <nav id="bottom-nav">
      <button id="session-title-btn" onClick={() => setPickerOpen(true)}>
        {activeSession()?.title || "New chat"}
      </button>
      <button
        id="new-chat-btn"
        class="btn btn-icon"
        onClick={() => void handleNewSession()}
        title="New chat"
      >
        +
      </button>
    </nav>
  );
}
