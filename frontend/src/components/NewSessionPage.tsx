/**
 * New session page — shown when no session is active.
 *
 * Displays a centered heading with a project selector, agent picker,
 * optional worktree checkbox, and a chat input.
 * When the user sends their first message, a session is created and
 * the view transitions instantly to the chat.
 *
 * Supports swipe-left to navigate to the most recent existing session.
 */

import ArrowUp from "lucide-solid/icons/arrow-up";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { attachSwipeHandler } from "../gestures";
import { createSessionAndSend, navigateNext } from "../sessions";
import {
  createNewWorktree,
  extractErrorMessage,
  projects,
  rootSessions,
  selectedAgent,
  selectedProject,
  selectedProjectDir,
  setCreateNewWorktree,
  setErrorMessage,
  setSelectedProjectDir,
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

  /** Display name for a project — use name if available, otherwise last path segment. */
  function projectLabel(worktree: string, name?: string): string {
    if (name) return name;
    const parts = worktree.split("/");
    return parts[parts.length - 1] ?? worktree;
  }

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
      await createSessionAndSend(
        value,
        selectedAgent(),
        selectedProjectDir(),
        createNewWorktree(),
      );
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

  // Swipe gesture handling — only supports swipe-left to go to most recent session
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
        if (rootSessions().length > 0) {
          pendingNav = navigateNext;
        }
        setAnimateSnap(true);
        setSwipeOffset(0);
      },
      onSwipeRight() {
        // No further pages past the new session page
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

  const showRightArrow = () => {
    const off = swipeOffset();
    return off < 0 && rootSessions().length > 0;
  };
  const arrowOpacity = () => Math.min(Math.abs(swipeOffset()) / 60, 1);

  return (
    <div class="chat-main">
      <div
        class="swipe-arrow swipe-arrow-right"
        style={{ opacity: showRightArrow() ? arrowOpacity() : 0 }}
        aria-hidden="true"
      >
        <ChevronRight size={24} />
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

          <Show when={projects().length > 1}>
            <select
              class="project-select"
              value={selectedProjectDir() ?? ""}
              onChange={(e) => {
                setSelectedProjectDir(e.currentTarget.value || undefined);
                setCreateNewWorktree(false);
              }}
              disabled={sending()}
            >
              <For each={projects()}>
                {(project) => (
                  <option value={project.worktree}>
                    {projectLabel(project.worktree, project.name)}
                  </option>
                )}
              </For>
            </select>
          </Show>

          <Show when={selectedProject()?.vcs === "git"}>
            <label class="worktree-checkbox">
              <input
                type="checkbox"
                checked={createNewWorktree()}
                onChange={(e) => setCreateNewWorktree(e.currentTarget.checked)}
                disabled={sending()}
              />
              Create worktree
            </label>
          </Show>

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
