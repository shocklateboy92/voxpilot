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
import {
  createSessionAndSend,
  navigateNext,
  rootSessions,
} from "../../app/navigation";
import { store } from "../../app/store";
import { createWorktree, fetchWorktrees } from "../../platform/api-client";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { Select } from "../../ui/Select";
import { SwipeablePane } from "../../ui/SwipeablePane";
import { Textarea } from "../../ui/Textarea";
import { TextInput } from "../../ui/TextInput";
import { AgentPicker } from "./AgentPicker";
import { effectiveAgent } from "./agent-selection";
import { ComposerForm } from "./ComposerForm";
import { ModelPicker } from "./ModelPicker";
import { selectedModel, selectedVariant } from "./preferences";

const ALWAYS_FALSE = () => false;

export function NewSessionPage() {
  let inputEl: HTMLTextAreaElement | undefined;

  const [sending, setSending] = createSignal(false);
  const [creatingWorktree, setCreatingWorktree] = createSignal(false);
  const [worktreeName, setWorktreeName] = createSignal("");

  // Component-local project/worktree selection, initialized from the current project
  const [selectedProjectDir, setSelectedProjectDir] = createSignal<
    string | undefined
  >(store.currentProject?.canonical);
  const [selectedWorktreeDir, setSelectedWorktreeDir] = createSignal<
    string | undefined
  >(undefined);

  // Derived: the full Project object for the selected directory
  const selectedProject = createMemo(() => {
    const dir = selectedProjectDir();
    if (!dir) return undefined;
    return store.projects.find((p) => p.canonical === dir);
  });

  // Fetch worktrees on demand — refetches when the selected git project changes
  const worktreeSource = () => {
    const project = selectedProject();
    return project?.vcs === "git" ? project.canonical : undefined;
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
        effectiveAgent(),
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
    <div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <SwipeablePane
        class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8"
        canSwipeLeft={canSwipeLeft}
        canSwipeRight={ALWAYS_FALSE}
        onSwipeLeft={navigateNext}
      >
        <div class="flex w-full max-w-lg flex-col items-center gap-5">
          <h1 class="m-0 text-2xl font-semibold text-text">New Chat</h1>

          <Show when={store.projects.length > 1}>
            <Select
              class="w-full"
              density="compact"
              mono
              aria-label="Project"
              value={selectedProjectDir() ?? ""}
              onChange={(e) => {
                setSelectedProjectDir(e.currentTarget.value || undefined);
                setSelectedWorktreeDir(undefined);
              }}
              disabled={busy()}
            >
              <For each={store.projects}>
                {(project) => (
                  <option value={project.canonical}>
                    {projectLabel(project.canonical, project.name)}
                  </option>
                )}
              </For>
            </Select>
          </Show>

          <Show when={selectedProject()?.vcs === "git"}>
            <div class="worktree-section flex w-full flex-col gap-2">
              <Select
                class="w-full"
                density="compact"
                mono
                aria-label="Worktree"
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
              </Select>

              <div class="flex items-center gap-2">
                <TextInput
                  type="text"
                  class="flex-1"
                  density="compact"
                  mono
                  aria-label="Worktree name"
                  placeholder="Worktree name (optional)"
                  value={worktreeName()}
                  onInput={(e) => setWorktreeName(e.currentTarget.value)}
                  disabled={busy()}
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  class="whitespace-nowrap"
                  onClick={() => void handleCreateWorktree()}
                  disabled={busy()}
                >
                  <Plus size={14} />
                  {creatingWorktree() ? "Creating..." : "New worktree"}
                </Button>
              </div>
            </div>
          </Show>

          <AgentPicker />
          <ModelPicker fullWidth />

          <ComposerForm onSubmit={(e) => void handleSubmit(e)}>
            <Textarea
              ref={inputEl}
              class="chat-input"
              variant="composer"
              data-composer-input
              aria-label="Message"
              placeholder="Send a message..."
              autocomplete="off"
              disabled={busy()}
              rows={1}
              onKeyDown={handleKeyDown}
              onInput={handleAutoResize}
            />
            <IconButton
              type="submit"
              variant="primary"
              disabled={busy()}
              aria-label="Send"
              // Keep focus in the composer so keyboard/nav changes cannot move the button mid-click.
              onPointerDown={(event) => event.preventDefault()}
            >
              <ArrowUp size={18} />
            </IconButton>
          </ComposerForm>
        </div>
      </SwipeablePane>
    </div>
  );
}
