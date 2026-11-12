/**
 * Main chat view — ContentShell (status bar + chat area + agent picker +
 * input) + bottom nav with session picker.
 *
 * Renders the NewSessionPage when no session is active (no sessions exist or
 * the user navigated past the newest one). Otherwise renders the normal chat
 * inside a ContentShell.
 */

import Check from "lucide-solid/icons/check";
import GitBranch from "lucide-solid/icons/git-branch";
import { createMemo, Show } from "solid-js";
import { createAttachmentDrop } from "../features/chat/attachments/attachment-input";
import {
  anchor,
  ChatMain,
  ChatScrollButton,
  chatPaneMount,
} from "../features/chat/ChatMain";
import { ContextUsageBar } from "../features/chat/ContextUsageBar";
import { composerDraft } from "../features/chat/create-composer-draft";
import { ModelPicker } from "../features/chat/ModelPicker";
import { NewSessionPage } from "../features/chat/NewSessionPage";
import { ServerPicker } from "../features/connection/ServerPicker";
import { MarkdownViewer } from "../features/files/MarkdownViewer";
import { ReviewOverlay } from "../features/review/ReviewOverlay";
import { BottomNav } from "./BottomNav";
import { ContentShell } from "./ContentShell";
import {
  activeSessionId,
  canNavigateNext,
  canNavigatePrev,
  isNewSessionPage,
  navigateNext,
  navigatePrev,
} from "./navigation";
import { store } from "./store";

export function ChatView() {
  const drop = createAttachmentDrop(() => composerDraft(activeSessionId()));
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
    <main
      class="app relative flex size-full flex-col overflow-hidden bg-surface px-3 pb-[calc(var(--bottom-nav-height)+var(--safe-bottom))] text-center"
      onDragEnter={drop.onDragEnter}
      onDragLeave={drop.onDragLeave}
      onDragOver={drop.onDragOver}
      onDrop={drop.onDrop}
      onDragEnd={drop.onDragEnd}
    >
      <Show when={drop.dragging()}>
        <div
          class="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-glass text-accent backdrop-blur-sm"
          role="status"
        >
          Drop images to attach
        </div>
      </Show>
      <Show when={!isNewSessionPage()} fallback={<NewSessionPage />}>
        <ContentShell
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
          statusBarRight={<ContextUsageBar />}
          canSwipeLeft={canNavigateNext}
          canSwipeRight={canNavigatePrev}
          onSwipeLeft={navigateNext}
          onSwipeRight={navigatePrev}
          paneClass="messages mx-auto min-h-0 w-full max-w-[66rem] flex-1 touch-pan-y overflow-x-clip overflow-y-auto px-[3vw] pt-(--status-bar-clearance) text-left"
          onPaneMount={chatPaneMount}
          onScroll={anchor.onScroll}
          composerOverlay={<ChatScrollButton />}
          aboveInput={
            <div class="flex w-full max-w-[66rem] flex-wrap items-end gap-2">
              <ServerPicker />
              <ModelPicker />
            </div>
          }
        >
          <ChatMain />
        </ContentShell>
      </Show>
      <BottomNav />
      <ReviewOverlay />
      <MarkdownViewer />
    </main>
  );
}
