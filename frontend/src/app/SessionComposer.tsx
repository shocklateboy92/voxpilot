import { type JSX, onCleanup, onMount, Show } from "solid-js";
import { ChatInput } from "../features/chat/ChatInput";
import { ChatScrollButton } from "../features/chat/ChatMain";
import { ModelPicker } from "../features/chat/ModelPicker";
import type { ReadingControls } from "../features/chat/reading-controls";
import { ServerPicker } from "../features/connection/ServerPicker";
import { configuredServer } from "../platform/connection-config";
import type { ViewerContext } from "../platform/prompt-files";

export function SessionComposer(props: {
  chatVisible: boolean;
  onResize: (height: number) => void;
  readingControls: ReadingControls;
  onSend: () => void;
  viewerContext?: ViewerContext;
  renderNavigationAction?: () => JSX.Element;
}) {
  let stack: HTMLElement | undefined;
  onMount(() => {
    if (!stack) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) props.onResize(entry.contentRect.height);
    });
    observer.observe(stack);
    onCleanup(() => observer.disconnect());
  });
  return (
    <footer
      ref={stack}
      data-composer-stack
      class="pointer-events-none absolute inset-x-3 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+0.75rem)] z-40 flex flex-col gap-2 [&>*]:pointer-events-auto"
      classList={{
        "items-end": props.readingControls.reading,
        "items-center": !props.readingControls.reading,
      }}
    >
      <Show when={props.chatVisible}>
        <ChatScrollButton />
      </Show>
      <Show when={!props.readingControls.reading}>
        <Show
          when={props.renderNavigationAction}
          fallback={
            <div class="flex w-full max-w-[66rem] flex-wrap items-end gap-2">
              <ServerPicker />
              <ModelPicker />
            </div>
          }
        >
          {(renderAction) => (
            <div class="grid w-full max-w-[66rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <Show when={configuredServer}>
                <div class="min-w-0 overflow-x-auto">
                  <ServerPicker />
                </div>
              </Show>
              <div
                class="min-w-0"
                classList={{ "col-span-2": Boolean(configuredServer) }}
              >
                <ModelPicker fullWidth />
              </div>
              <div class="col-start-2 row-start-1 justify-self-end">
                {renderAction()()}
              </div>
            </div>
          )}
        </Show>
      </Show>
      <ChatInput
        readingControls={props.readingControls}
        onSend={props.onSend}
        viewerContext={props.viewerContext}
        renderNavigationAction={props.renderNavigationAction}
      />
    </footer>
  );
}
