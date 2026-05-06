/**
 * Bottom navigation bar — session title (tap to open picker), fork, and + button.
 */

import GitFork from "lucide-solid/icons/git-fork";
import Plus from "lucide-solid/icons/plus";
import { createSignal, Show } from "solid-js";
import {
  activeSession,
  handleNewSession,
  isNewSessionPage,
} from "../navigation";
import { ForkOverlay } from "./ForkOverlay";
import { SessionPicker } from "./SessionPicker";

export function BottomNav() {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [forkOpen, setForkOpen] = createSignal(false);

  return (
    <nav class="bottom-nav">
      <button
        type="button"
        class="session-title-btn"
        onClick={() => setPickerOpen(true)}
      >
        {activeSession()?.title || "New chat"}
      </button>
      <button
        type="button"
        class="fork-btn btn btn-icon"
        onClick={() => setForkOpen(true)}
        title="Fork conversation"
        disabled={isNewSessionPage()}
      >
        <GitFork size={20} />
      </button>
      <button
        type="button"
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
      <Show when={forkOpen()}>
        <ForkOverlay onClose={() => setForkOpen(false)} />
      </Show>
    </nav>
  );
}
