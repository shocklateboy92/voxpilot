/**
 * New session page — shown when no session is active.
 *
 * Displays a centered heading with a project selector, worktree picker
 * (with inline creation), agent picker, and a chat input.
 * When the user sends their first message, a session is created and
 * the view transitions instantly to the chat.
 *
 * Supports swipe-left to navigate to the most recent existing session.
 */

import ArrowUp from "lucide-solid/icons/arrow-up";
import Plus from "lucide-solid/icons/plus";
import {
  createMemo,
  createResource,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { createWorktree, fetchWorktrees } from "../api-client";
import {
  createSessionAndSend,
  navigateNext,
  rootSessions,
} from "../navigation";
import { selectedAgent, selectedModel, selectedVariant } from "../preferences";
import { store } from "../store";
import { AgentPicker } from "./AgentPicker";
import { ModelPicker } from "./ModelPicker";
import { SwipeablePane } from "./SwipeablePane";

const ALWAYS_FALSE = () => false as const;

export function NewSessionPage() {
  let inputEl: HTMLTextAreaElement | undefined;

  const [sending, setSending] = createSignal(false);
  const [creatingWorktree, setCreatingWorktree] = createSignal(false);
  const [worktreeName, setWorktreeName] = createSignal("");

  // Component-local project/worktree selection, initialized from the current project
  const [selectedProjectDir, setSelectedProjectDir] = createSignal<
    string | undefined
  >(store.currentProject?.worktree);
  const [selectedWorktreeDir, setSelectedWorktreeDir] = createSignal<
    string | undefined
  >(undefined);

  // Derived: the full Project object for the selected directory
  const selectedProject = createMemo(() => {
    const dir = selectedProjectDir();
    if (!dir) return undefined;
    return store.projects.find((p) => p.worktree === dir);
  });

  // Fetch worktrees on demand — refetches when the selected git project changes
  const worktreeSource = () => {
    const project = selectedProject();
    return project?.vcs === "git" ? project.worktree : undefined;
  };
  const [worktrees, { refetch: refetchWorktrees }] = createResource(
    worktreeSource,
    fetchWorktrees,
    { initialValue: [] },
  );

  /** Display name for a project — use name if available, otherwise last path segment. */
  function projectLabel(worktree: string, name?: string): string {
    if (name) return name;
    const parts = worktree.split("/");
    return parts[parts.length - 1] ?? worktree;
  }

  /** Display name for a worktree directory — last path segment. */
  function worktreeLabel(dir: string): string {
    const parts = dir.split("/");
    return parts[parts.length - 1] ?? dir;
  }

  onMount(() => {
    inputEl?.focus();
  });

  async function handleSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const value = inputEl?.value.trim();
    if (!value || sending()) return;

    if (inputEl) {
      inputEl.value = "";
      inputEl.style.height = "auto";
    }

    // Use the selected worktree directory, falling back to the project root
    const directory = selectedWorktreeDir() ?? selectedProjectDir();

    setSending(true);
    try {
        await createSessionAndSend(
          value,
          selectedAgent(),
          directory,
          selectedModel(),
          selectedVariant(),
        );
    } finally {
      setSending(false);
    }
  }

  async function handleCreateWorktree(): Promise<void> {
    const dir = selectedProjectDir();
    if (!dir || creatingWorktree()) return;

    const name = worktreeName().trim() || undefined;
    setCreatingWorktree(true);
    try {
      const wt = await createWorktree(dir, name);
      await refetchWorktrees();
      setSelectedWorktreeDir(wt.directory);
      setWorktreeName("");
    } finally {
      setCreatingWorktree(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const target = e.currentTarget;
      if (target instanceof HTMLTextAreaElement) {
        target.form?.requestSubmit();
      }
    }
  }

  function handleAutoResize(): void {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    inputEl.style.height = `${inputEl.scrollHeight}px`;
  }

  const canSwipeLeft = () => rootSessions().length > 0;
  const busy = () => sending() || creatingWorktree();

  return (
    <div class="content-shell-body">
      <SwipeablePane
        class="new-session-page"
        canSwipeLeft={canSwipeLeft}
        canSwipeRight={ALWAYS_FALSE}
        onSwipeLeft={navigateNext}
      >
        <div class="new-session-content">
          <h1 class="new-session-heading">New Chat</h1>

          <Show when={store.projects.length > 1}>
            <select
              class="project-select"
              value={selectedProjectDir() ?? ""}
              onChange={(e) => {
                setSelectedProjectDir(e.currentTarget.value || undefined);
                setSelectedWorktreeDir(undefined);
              }}
              disabled={busy()}
            >
              <For each={store.projects}>
                {(project) => (
                  <option value={project.worktree}>
                    {projectLabel(project.worktree, project.name)}
                  </option>
                )}
              </For>
            </select>
          </Show>

          <Show when={selectedProject()?.vcs === "git"}>
            <div class="worktree-section">
              <select
                class="project-select"
                value={selectedWorktreeDir() ?? ""}
                onChange={(e) => {
                  setSelectedWorktreeDir(e.currentTarget.value || undefined);
                }}
                disabled={busy()}
              >
                <option value="">Main worktree</option>
                <For each={worktrees()}>
                  {(dir) => <option value={dir}>{worktreeLabel(dir)}</option>}
                </For>
              </select>

              <div class="worktree-create">
                <input
                  type="text"
                  class="worktree-name-input"
                  placeholder="Worktree name (optional)"
                  value={worktreeName()}
                  onInput={(e) => setWorktreeName(e.currentTarget.value)}
                  disabled={busy()}
                />
                <button
                  type="button"
                  class="btn btn-primary"
                  onClick={() => void handleCreateWorktree()}
                  disabled={busy()}
                >
                  <Plus size={14} />
                  {creatingWorktree() ? "Creating..." : "New worktree"}
                </button>
              </div>
            </div>
          </Show>

          <AgentPicker />
          <ModelPicker />

          <form class="chat-form" onSubmit={(e) => void handleSubmit(e)}>
            <textarea
              ref={inputEl}
              class="chat-input"
              placeholder="Send a message..."
              autocomplete="off"
              disabled={busy()}
              rows={1}
              onKeyDown={handleKeyDown}
              onInput={handleAutoResize}
            />
            <button
              type="submit"
              class="btn btn-primary btn-icon"
              disabled={busy()}
              aria-label="Send"
            >
              <ArrowUp size={18} />
            </button>
          </form>
        </div>
      </SwipeablePane>
    </div>
  );
}
