/**
 * Bottom navigation bar — session title (tap to open picker) and + button.
 */

import { Plus } from "lucide-solid";
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
        <Plus size={20} />
      </button>
    </nav>
  );
}
