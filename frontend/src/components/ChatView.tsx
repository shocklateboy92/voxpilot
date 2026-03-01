/**
 * Main chat view — ContentShell (status bar + chat area + agent picker +
 * input) + bottom nav with session picker.
 *
 * Renders the NewSessionPage when no session is active (no sessions exist or
 * the user navigated past the newest one). Otherwise renders the normal chat
 * inside a ContentShell.
 */

import GitBranch from "lucide-solid/icons/git-branch";
import { Show } from "solid-js";
import {
  canNavigateNext,
  canNavigatePrev,
  navigateNext,
  navigatePrev,
} from "../sessions";
import { gitBranch, isNewSessionPage } from "../store";
import { AgentPicker } from "./AgentPicker";
import { BottomNav } from "./BottomNav";
import { ChatMain, chatPaneMount, ChatScrollButton } from "./ChatMain";
import { ContentShell } from "./ContentShell";
import { ContextUsageBar } from "./ContextUsageBar";
import { NewSessionPage } from "./NewSessionPage";
import { ReviewOverlay } from "./ReviewOverlay";
import { SessionPicker } from "./SessionPicker";

export function ChatView() {
  return (
    <main class="app">
      <Show when={!isNewSessionPage()} fallback={<NewSessionPage />}>
        <ContentShell
          statusBarLeft={
            <Show
              when={gitBranch()}
              fallback={<span class="status-bar-branch-placeholder" />}
            >
              {(branch) => (
                <span class="status-bar-branch" title={branch()}>
                  <GitBranch size={14} />
                  {branch()}
                </span>
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
          overlay={<ChatScrollButton />}
          aboveInput={<AgentPicker />}
        >
          <ChatMain />
        </ContentShell>
      </Show>
      <BottomNav />
      <SessionPicker />
      <ReviewOverlay />
    </main>
  );
}
