/**
 * New session page — shown when no session is active.
 *
 * Displays a centered heading with the agent picker and a chat input.
 * When the user sends their first message, a session is created and
 * the view transitions instantly to the chat.
 *
 * Supports swipe-right to navigate back to the last existing session.
 * Structured to support future workspace/worktree selection.
 */

import ArrowUp from "lucide-solid/icons/arrow-up";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import { createSignal, onCleanup, onMount } from "solid-js";
import { attachSwipeHandler } from "../gestures";
import { createSessionAndSend, navigatePrev } from "../sessions";
import {
  extractErrorMessage,
  rootSessions,
  selectedAgent,
  setErrorMessage,
  setSwipeOffset,
  showToast,
  swipeOffset,
} from "../store";
import { AgentPicker } from "./AgentPicker";

export function NewSessionPage() {
  let pageRef: HTMLDivElement | undefined;
  let inputEl: HTMLTextAreaElement | undefined;

  const [animateSnap, setAnimateSnap] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  let pendingNav: (() => void) | null = null;

  function handleTransitionEnd(): void {
    setAnimateSnap(false);
    if (pendingNav) {
      const nav = pendingNav;
      pendingNav = null;
      nav();
    }
  }

  async function handleSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const value = inputEl?.value.trim();
    if (!value || sending()) return;

    if (inputEl) {
      inputEl.value = "";
      inputEl.style.height = "auto";
    }

    setSending(true);
    setErrorMessage(null);
    try {
      await createSessionAndSend(value, selectedAgent());
    } catch (err: unknown) {
      showToast(extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const form = inputEl?.closest("form");
      if (form) {
        form.requestSubmit();
      }
    }
  }

  function handleAutoResize(): void {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    inputEl.style.height = `${inputEl.scrollHeight}px`;
  }

  // Swipe gesture handling — only supports swipe-right to go back
  onMount(() => {
    if (!pageRef) {
      throw new Error(
        "Component mounted without pageRef reference being set",
      );
    }

    inputEl?.focus();

    const cleanup = attachSwipeHandler(pageRef, {
      onSwipeMove(deltaX) {
        setAnimateSnap(false);
        pendingNav = null;
        const damped =
          Math.sign(deltaX) * Math.min(Math.sqrt(Math.abs(deltaX)) * 5, 100);
        setSwipeOffset(damped);
      },
      onSwipeLeft() {
        // No further sessions past the new session page
        setAnimateSnap(true);
        setSwipeOffset(0);
      },
      onSwipeRight() {
        if (rootSessions().length > 0) {
          pendingNav = navigatePrev;
        }
        setAnimateSnap(true);
        setSwipeOffset(0);
      },
      onSwipeCancel() {
        setAnimateSnap(true);
        setSwipeOffset(0);
      },
    });

    onCleanup(cleanup);
  });

  const showLeftArrow = () => {
    const off = swipeOffset();
    return off > 0 && rootSessions().length > 0;
  };
  const arrowOpacity = () => Math.min(Math.abs(swipeOffset()) / 60, 1);

  return (
    <div class="chat-main">
      <div
        class="swipe-arrow swipe-arrow-left"
        style={{ opacity: showLeftArrow() ? arrowOpacity() : 0 }}
        aria-hidden="true"
      >
        <ChevronLeft size={24} />
      </div>
      <div
        ref={pageRef}
        class="new-session-page"
        style={{
          transform: `translateX(${swipeOffset()}px)`,
          transition: animateSnap() ? "transform 200ms ease-out" : "none",
        }}
        onTransitionEnd={handleTransitionEnd}
      >
        <div class="new-session-content">
          <h1 class="new-session-heading">New Chat</h1>

          {/* Future: workspace/worktree selector goes here */}

          <AgentPicker />

          <form class="chat-form" onSubmit={(e) => void handleSubmit(e)}>
            <textarea
              ref={inputEl}
              class="chat-input"
              placeholder="Send a message..."
              autocomplete="off"
              disabled={sending()}
              rows={1}
              onKeyDown={handleKeyDown}
              onInput={handleAutoResize}
            />
            <button
              type="submit"
              class="btn btn-icon"
              disabled={sending()}
              aria-label="Send"
            >
              <ArrowUp size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
