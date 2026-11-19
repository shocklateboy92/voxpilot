import { type JSX, onCleanup, onMount, Show } from "solid-js";
import { ChatInput } from "../features/chat/ChatInput";
import { ChatScrollButton } from "../features/chat/ChatMain";
import { ModelPicker } from "../features/chat/ModelPicker";
import type { ReadingControls } from "../features/chat/reading-controls";
import { ServerPicker } from "../features/connection/ServerPicker";
import { configuredServer } from "../platform/connection-config";

export function SessionComposer(props: {
  chatVisible: boolean;
  onResize: (height: number) => void;
  readingControls: ReadingControls;
  onSend: () => void;
  navigationAction?: JSX.Element;
}) {
  const withAction = () => Boolean(props.navigationAction);
  const actionBesideServer = () => withAction() && Boolean(configuredServer);
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
        <div
          class="w-full max-w-[66rem] gap-2"
          classList={{
            "flex flex-wrap items-end": !withAction(),
            "grid grid-cols-[minmax(0,1fr)_auto] items-center": withAction(),
          }}
        >
          <div
            classList={{
              contents: !actionBesideServer(),
              "min-w-0 overflow-x-auto": actionBesideServer(),
            }}
          >
            <ServerPicker />
          </div>
          <div
            classList={{
              contents: !withAction(),
              "min-w-0": withAction(),
              "col-span-2": actionBesideServer(),
            }}
          >
            <ModelPicker fullWidth={withAction()} />
          </div>
          <Show when={withAction()}>
            <div class="col-start-2 row-start-1 justify-self-end">
              {props.navigationAction}
            </div>
          </Show>
        </div>
      </Show>
      <ChatInput
        readingControls={props.readingControls}
        onSend={props.onSend}
        navigationAction={
          props.readingControls.reading ? props.navigationAction : undefined
        }
      />
    </footer>
  );
}
