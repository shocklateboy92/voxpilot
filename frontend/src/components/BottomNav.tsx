/**
 * Bottom navigation bar — session title (tap to open picker) and + button.
 */

import { createSignal, Show } from "solid-js";
import Plus from "lucide-solid/icons/plus";
import { handleNewSession } from "../navigation";
import { activeSession, isNewSessionPage } from "../store";
import { SessionPicker } from "./SessionPicker";

export function BottomNav() {
  const [pickerOpen, setPickerOpen] = createSignal(false);

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
      <Show when={pickerOpen()}>
        <SessionPicker onClose={() => setPickerOpen(false)} />
      </Show>
    </nav>
  );
}
