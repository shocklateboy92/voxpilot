import { errorMessage } from "@plugin/file-preview";
import { MIN_PRINT_WIDTH } from "@plugin/rpc";
import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { rpc } from "../../platform/rpc";
import { observePrintWidth } from "../../ui/code-print-width";
import { Spinner } from "../../ui/Spinner";
import type { FileRequest } from "./file-state";

export function CodePreview(props: { request: FileRequest; text: string }) {
  let container: HTMLDivElement | undefined;
  let code: HTMLElement | undefined;
  let pending: AbortController | undefined;
  let jumped = false;
  const sourceLine = () => {
    const match = /^L([1-9]\d*)$/.exec(props.request.fragment ?? "");
    const line = Number(match?.[1]);
    return Number.isSafeInteger(line) ? line : undefined;
  };
  const [width, setWidth] = createSignal<number>();
  onMount(() => {
    if (container)
      onCleanup(observePrintWidth(container, setWidth, MIN_PRINT_WIDTH));
  });
  onCleanup(() => pending?.abort());

  const request = () => {
    const printWidth = width();
    if (!printWidth) return;
    return {
      filePath: props.request.path,
      text: props.text,
      printWidth,
      sourceLine: sourceLine(),
    };
  };
  const [preview] = createResource(request, async (input) => {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    try {
      return await rpc.formatCodePreview(input, { signal: controller.signal });
    } catch (error) {
      // A superseded request is ignored by the resource; never show its abort.
      controller.signal.throwIfAborted();
      return { error: errorMessage(error, "Unable to format this file.") };
    }
  });
  const formatted = () => {
    const result = preview.latest;
    return result && "html" in result ? result : undefined;
  };
  const error = () => {
    const result = preview.latest;
    return result && "error" in result ? result.error : undefined;
  };

  createEffect(() => {
    if (jumped || !formatted()?.targetFound) return;
    const frame = requestAnimationFrame(() => {
      const target = code?.querySelector("[data-code-target]");
      if (!target) return;
      target.scrollIntoView({ block: "start" });
      jumped = true;
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  return (
    <div ref={container} class="code-preview min-w-0">
      <Show
        when={formatted()}
        fallback={
          <Show when={error()} fallback={<Spinner />}>
            {(message) => (
              <div role="alert" class="p-4 text-error">
                {message()}
              </div>
            )}
          </Show>
        }
      >
        {(result) => (
          <>
            <Show when={sourceLine() && !result().targetFound}>
              <p role="status" class="px-(--cell-padding) text-xs text-muted">
                Exact source line not located in this preview.
              </p>
            </Show>
            <pre class="m-0 font-mono text-(length:--code-font-size) leading-(--code-line-height) whitespace-normal">
              <code
                ref={code}
                // eslint-disable-next-line solid/no-innerhtml -- the plugin escapes source and validates syntax colors
                innerHTML={result().html}
              />
            </pre>
          </>
        )}
      </Show>
    </div>
  );
}
