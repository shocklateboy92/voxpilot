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
import {
  canNavigateNext,
  canNavigatePrev,
  isNewSessionPage,
  navigateNext,
  navigatePrev,
} from "../navigation";
import { store } from "../store";
import { AgentPicker } from "./AgentPicker";
import { BottomNav } from "./BottomNav";
import {
  anchor,
  ChatMain,
  chatPaneMount,
  ChatScrollButton,
} from "./ChatMain";
import { ContentShell } from "./ContentShell";
import { ContextUsageBar } from "./ContextUsageBar";
import { NewSessionPage } from "./NewSessionPage";
import { ReviewOverlay } from "./ReviewOverlay";

export function ChatView() {
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
    <main class="app">
      <Show when={!isNewSessionPage()} fallback={<NewSessionPage />}>
        <ContentShell
          statusBarLeft={
            <Show
              when={store.gitBranch}
              fallback={<span class="status-bar-branch-placeholder" />}
            >
              {(branch) => (
                <>
                  <GitBranch size={14} class="wt-icon-fixed" />
                  <span class="wt-branch" title={branch()}>
                    {branch()}
                  </span>
                  <Show
                    when={changeCounts().total > 0}
                    fallback={
                      <>
                        <span class="wt-separator">·</span>
                        <Check size={14} class="wt-check" />
                        <span class="wt-label">clean</span>
                      </>
                    }
                  >
                    <span class="wt-separator">·</span>
                    <span class="wt-count">{changeCounts().total}</span>
                    <span class="wt-label">changed</span>
                    <span class="wt-breakdown">
                      (+{changeCounts().added} ~{changeCounts().modified} -{changeCounts().deleted})
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
          paneClass="messages"
          onPaneMount={chatPaneMount}
          onScroll={anchor.onScroll}
          overlay={<ChatScrollButton />}
          aboveInput={<AgentPicker />}
        >
          <ChatMain />
        </ContentShell>
      </Show>
      <BottomNav />
      <ReviewOverlay />
    </main>
  );
}
