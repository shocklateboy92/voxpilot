/**
 * Bottom navigation bar — session title (tap to open picker) and + button.
 */

import Plus from "lucide-solid/icons/plus";
import { handleNewSession } from "../sessions";
import { activeSession, isNewSessionPage, setPickerOpen } from "../store";

export function BottomNav() {
  return (
    <nav class="bottom-nav">
      <button class="session-title-btn" onClick={() => setPickerOpen(true)}>
        {activeSession()?.title || "New chat"}
      </button>
      <button
        class="new-chat-btn btn btn-icon"
        onClick={() => handleNewSession()}
        title="New chat"
        disabled={isNewSessionPage()}
      >
        <Plus size={20} />
      </button>
    </nav>
  );
}
