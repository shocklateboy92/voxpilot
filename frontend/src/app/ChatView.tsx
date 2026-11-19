/** Session layout — chat, review, and Markdown share one composer footer. */

import { createEffect, createSignal, on, Show } from "solid-js";
import { createAttachmentDrop } from "../features/chat/attachments/attachment-input";
import { composerDraft } from "../features/chat/create-composer-draft";
import { NewSessionPage } from "../features/chat/NewSessionPage";
import { MarkdownViewer } from "../features/files/MarkdownViewer";
import {
  ReviewOverlay,
  reviewFile,
  setReviewFile,
} from "../features/review/ReviewOverlay";
import { BottomNav } from "./BottomNav";
import { createComposerKeyboard } from "./create-composer-keyboard";
import { activeSessionId, isNewSessionPage } from "./navigation";
import { closeFile, currentFile } from "./routing";
import { SessionChatPane } from "./SessionChatPane";
import { SessionComposer } from "./SessionComposer";

export function ChatView() {
  const [composing, setComposing] = createSignal(false);
  const reading = () => !isNewSessionPage() && !composing();
  const readingControls = {
    get reading() {
      return reading();
    },
    expand: () => setComposing(true),
    collapse: () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement) focused.blur();
      setComposing(false);
    },
  };
  const keyboard = createComposerKeyboard();
  const [composerHeight, setComposerHeight] = createSignal(0);
  const viewing = () => Boolean(reviewFile() || currentFile());
  const closeView = () => {
    if (currentFile()) closeFile();
    else setReviewFile(null);
  };
  createEffect(on(activeSessionId, () => setReviewFile(null), { defer: true }));
  const drop = createAttachmentDrop(() => composerDraft(activeSessionId()));

  return (
    <main
      class="app relative flex size-full flex-col overflow-hidden bg-surface px-3 pb-[calc(var(--bottom-nav-height)+var(--safe-bottom))] text-center"
      classList={{
        "viewer-open": viewing(),
        "composer-keyboard-active": keyboard.active(),
        "reading-mode": reading(),
      }}
      onFocusIn={keyboard.onFocusIn}
      onFocusOut={keyboard.onFocusOut}
      onDragEnter={drop.onDragEnter}
      onDragLeave={drop.onDragLeave}
      onDragOver={drop.onDragOver}
      onDrop={drop.onDrop}
      onDragEnd={drop.onDragEnd}
    >
      <Show when={drop.dragging()}>
        <div
          class="pointer-events-none absolute inset-2 z-210 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-glass text-accent backdrop-blur-sm"
          role="status"
        >
          Drop images to attach
        </div>
      </Show>
      <div
        class="contents"
        inert={viewing()}
        classList={{ invisible: viewing() }}
      >
        <Show
          when={!isNewSessionPage()}
          fallback={
            <NewSessionPage
              onCompose={readingControls.expand}
              onSend={readingControls.collapse}
            />
          }
        >
          <SessionChatPane
            composerHeight={composerHeight()}
            readingControls={readingControls}
          />
        </Show>
        <Show when={!reading()}>
          <BottomNav />
        </Show>
      </div>
      <div
        class="contents"
        inert={Boolean(currentFile())}
        classList={{ invisible: Boolean(currentFile()) }}
      >
        <ReviewOverlay
          composerHeight={composerHeight()}
          readingControls={readingControls}
        />
      </div>
      <MarkdownViewer
        composerHeight={composerHeight()}
        readingControls={readingControls}
      />
      <Show when={!isNewSessionPage()}>
        <SessionComposer
          chatVisible={!viewing()}
          onResize={setComposerHeight}
          readingControls={readingControls}
          onSend={closeView}
        />
      </Show>
    </main>
  );
}
