/**
 * Bottom navigation bar — session title (tap to open picker), fork, and + button.
 */

import GitCompare from "lucide-solid/icons/git-compare-arrows";
import GitFork from "lucide-solid/icons/git-fork";
import Plus from "lucide-solid/icons/plus";
import Settings from "lucide-solid/icons/settings";
import { createSignal, Show } from "solid-js";
import { changeServer } from "../connection";
import {
  activeSession,
  handleNewSession,
  isNewSessionPage,
} from "../navigation";
import { ForkOverlay } from "./ForkOverlay";
import { ReviewPicker } from "./ReviewPicker";
import { SessionPicker } from "./SessionPicker";

export function BottomNav() {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [forkOpen, setForkOpen] = createSignal(false);
  const [reviewOpen, setReviewOpen] = createSignal(false);

  return (
    <nav class="bottom-nav">
      <button
        type="button"
        class="btn btn-icon"
        title="Connection settings"
        onClick={changeServer}
      >
        <Settings size={20} />
      </button>
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
      <button
        type="button"
        class="btn btn-icon"
        title="Review changes"
        disabled={isNewSessionPage()}
        onClick={() => setReviewOpen(true)}
      >
        <GitCompare size={20} />
      </button>
      <Show when={reviewOpen()}>
        <ReviewPicker onClose={() => setReviewOpen(false)} />
      </Show>
      <Show when={forkOpen()}>
        <ForkOverlay onClose={() => setForkOpen(false)} />
      </Show>
    </nav>
  );
}
