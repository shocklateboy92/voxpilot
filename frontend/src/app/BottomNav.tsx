/**
 * Bottom navigation bar — session title (tap to open picker), fork, and + button.
 */

import GitCompare from "lucide-solid/icons/git-compare-arrows";
import GitFork from "lucide-solid/icons/git-fork";
import Plus from "lucide-solid/icons/plus";
import Settings from "lucide-solid/icons/settings";
import { createSignal, Show } from "solid-js";
import { ReviewPicker } from "../features/review/ReviewPicker";
import { ForkOverlay } from "../features/sessions/ForkOverlay";
import { SessionPicker } from "../features/sessions/SessionPicker";
import { changeServer } from "../platform/connection";
import { IconButton } from "../ui/IconButton";
import {
  activeSession,
  handleNewSession,
  isNewSessionPage,
} from "./navigation";

export function BottomNav() {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [forkOpen, setForkOpen] = createSignal(false);
  const [reviewOpen, setReviewOpen] = createSignal(false);

  return (
    <nav
      data-bottom-nav
      class="bottom-nav absolute inset-x-0 bottom-0 z-50 flex h-[calc(var(--bottom-nav-height)+var(--safe-bottom))] items-center justify-between gap-1 border-t border-border bg-surface px-4 pb-(--safe-bottom)"
    >
      <IconButton
        type="button"
        aria-label="Connection settings"
        title="Connection settings"
        onClick={changeServer}
      >
        <Settings size={20} />
      </IconButton>
      <button
        type="button"
        class="session-title-btn min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent py-2 text-left font-sans text-[0.85rem] font-semibold text-text after:text-[0.7rem] after:text-muted after:content-['_▾']"
        onClick={() => setPickerOpen(true)}
      >
        {activeSession()?.title || "New chat"}
      </button>
      <IconButton
        type="button"
        aria-label="Fork conversation"
        onClick={() => setForkOpen(true)}
        title="Fork conversation"
        disabled={isNewSessionPage()}
      >
        <GitFork size={20} />
      </IconButton>
      <IconButton
        type="button"
        aria-label="New chat"
        onClick={() => handleNewSession()}
        title="New chat"
        disabled={isNewSessionPage()}
      >
        <Plus size={20} />
      </IconButton>
      <Show when={pickerOpen()}>
        <SessionPicker onClose={() => setPickerOpen(false)} />
      </Show>
      <IconButton
        type="button"
        aria-label="Review changes"
        title="Review changes"
        disabled={isNewSessionPage()}
        onClick={() => setReviewOpen(true)}
      >
        <GitCompare size={20} />
      </IconButton>
      <Show when={reviewOpen()}>
        <ReviewPicker onClose={() => setReviewOpen(false)} />
      </Show>
      <Show when={forkOpen()}>
        <ForkOverlay onClose={() => setForkOpen(false)} />
      </Show>
    </nav>
  );
}
