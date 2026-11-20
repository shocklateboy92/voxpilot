import Check from "lucide-solid/icons/check";
import GitBranch from "lucide-solid/icons/git-branch";
import { createMemo, createSignal, Show } from "solid-js";
import { anchor, ChatMain, chatPaneMount } from "../features/chat/ChatMain";
import {
  ContextUsageBar,
  createContextUsage,
} from "../features/chat/ContextUsageBar";
import type { ReadingControls } from "../features/chat/reading-controls";
import { Button } from "../ui/Button";
import { ContentShell } from "./ContentShell";
import {
  canNavigateNext,
  canNavigatePrev,
  navigateNext,
  navigatePrev,
} from "./navigation";
import { store } from "./store";

export function SessionChatPane(props: {
  composerHeight: number;
  readingControls: ReadingControls;
}) {
  const context = createContextUsage();
  const [copiedBranch, setCopiedBranch] = createSignal<string>();
  const copyBranch = async () => {
    const branch = store.gitBranch;
    if (!branch) return;
    await navigator.clipboard.writeText(branch);
    setCopiedBranch(branch);
  };
  const changeCounts = createMemo(() => {
    const files = store.changedFiles;
    let added = 0;
    let modified = 0;
    let deleted = 0;
    for (const f of files) {
      if (f.status === "added") added++;
      else if (f.status === "modified") modified++;
      else if (f.status === "deleted") deleted++;
    }
    return { total: files.length, added, modified, deleted };
  });

  return (
    <ContentShell
      composerHeight={props.composerHeight}
      readingControls={props.readingControls}
      statusBarLeft={
        <Show when={store.gitBranch} fallback={<span class="h-4 w-px" />}>
          {(branch) => (
            <>
              <GitBranch size={14} class="shrink-0" />
              <span class="min-w-0 truncate" title={branch()}>
                {branch()}
              </span>
              <Show
                when={changeCounts().total > 0}
                fallback={
                  <>
                    <span class="hidden min-[300px]:inline">·</span>
                    <Check
                      size={14}
                      class="hidden text-ok min-[300px]:inline"
                    />
                    <span class="hidden min-[370px]:inline">clean</span>
                  </>
                }
              >
                <span class="hidden min-[300px]:inline">·</span>
                <span class="hidden min-[300px]:inline">
                  {changeCounts().total}
                </span>
                <span class="hidden min-[370px]:inline">changed</span>
                <span class="hidden min-[440px]:inline">
                  (+{changeCounts().added} ~{changeCounts().modified} -
                  {changeCounts().deleted})
                </span>
              </Show>
            </>
          )}
        </Show>
      }
      statusBarRight={<ContextUsageBar context={context} />}
      statusBarDetails={
        <dl class="flex min-w-0 flex-col gap-4">
          <div>
            <div class="mb-1 flex items-center justify-between gap-2">
              <dt class="text-xs font-semibold text-muted">Branch</dt>
              <Show when={store.gitBranch}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyBranch}
                  aria-label="Copy branch name"
                >
                  Copy
                </Button>
              </Show>
            </div>
            <dd>
              <div class="font-mono select-text [overflow-wrap:anywhere]">
                {store.gitBranch || "No branch available"}
              </div>
              <span role="status" class="text-xs text-muted">
                {copiedBranch() && copiedBranch() === store.gitBranch
                  ? "Branch name copied"
                  : ""}
              </span>
            </dd>
          </div>
          <div>
            <dt class="mb-1 text-xs font-semibold text-muted">Working copy</dt>
            <dd>
              <Show
                when={changeCounts().total > 0}
                fallback={<span class="text-ok">Clean — no changed files</span>}
              >
                <div>
                  {changeCounts().total} changed{" "}
                  {changeCounts().total === 1 ? "file" : "files"}
                </div>
                <div class="mt-1 text-xs text-muted">
                  {changeCounts().added} added · {changeCounts().modified}{" "}
                  modified · {changeCounts().deleted} deleted
                </div>
              </Show>
            </dd>
          </div>
          <div>
            <dt class="mb-1 text-xs font-semibold text-muted">Context</dt>
            <dd>
              <Show when={context()} fallback="No context usage yet">
                {(ctx) => (
                  <>
                    {ctx().total.toLocaleString()}
                    <Show when={ctx().limit}>
                      {(limit) => <> / {limit().toLocaleString()}</>}
                    </Show>{" "}
                    tokens
                    <Show when={ctx().percentage !== undefined}>
                      {" "}
                      ({ctx().percentage}% used)
                    </Show>
                  </>
                )}
              </Show>
            </dd>
          </div>
        </dl>
      }
      canSwipeLeft={canNavigateNext}
      canSwipeRight={canNavigatePrev}
      onSwipeLeft={navigateNext}
      onSwipeRight={navigatePrev}
      paneClass="messages mx-auto min-h-0 w-full max-w-[66rem] flex-1 touch-pan-y overflow-x-clip overflow-y-auto px-[3vw] pt-(--status-bar-clearance) text-left"
      onPaneMount={chatPaneMount}
      onScroll={anchor.onScroll}
    >
      <ChatMain />
    </ContentShell>
  );
}
