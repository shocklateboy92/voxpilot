import { onCleanup, onMount, Show } from "solid-js";
import { ChatInput } from "../features/chat/ChatInput";
import { ChatScrollButton } from "../features/chat/ChatMain";
import { ModelPicker } from "../features/chat/ModelPicker";
import type { ReadingControls } from "../features/chat/reading-controls";
import { ServerPicker } from "../features/connection/ServerPicker";

export function SessionComposer(props: {
  chatVisible: boolean;
  onResize: (height: number) => void;
  readingControls: ReadingControls;
  onSend: () => void;
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
        <div class="flex w-full max-w-[66rem] flex-wrap items-end gap-2">
          <ServerPicker />
          <ModelPicker />
        </div>
      </Show>
      <ChatInput
        readingControls={props.readingControls}
        onSend={props.onSend}
      />
    </footer>
  );
}
