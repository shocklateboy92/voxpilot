/**
 * Bottom navigation bar — session title (tap to open picker) and + button.
 */

import { Plus } from "lucide-solid";
import { handleNewSession } from "../sessions";
import { activeSession, setPickerOpen } from "../store";

export function BottomNav() {
  return (
    <nav class="bottom-nav">
      <button class="session-title-btn" onClick={() => setPickerOpen(true)}>
        {activeSession()?.title || "New chat"}
      </button>
      <button
        class="new-chat-btn btn btn-icon"
        onClick={() => void handleNewSession()}
        title="New chat"
      >
        <Plus size={20} />
      </button>
    </nav>
  );
}
