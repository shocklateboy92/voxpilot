import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { renderMarkdown } from "./markdown";
import { renderMermaid } from "./mermaid";

/** Shared typography, link rendering, and heading anchors for Markdown. */
export function MarkdownView(props: {
  text: string;
  resolveLink?: Parameters<typeof renderMarkdown>[1];
  onMount?: (element: HTMLDivElement) => void;
}) {
  let root: HTMLDivElement | undefined;
  const html = createMemo(() => renderMarkdown(props.text, props.resolveLink));
  const [light, setLight] = createSignal(false);
  onMount(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setLight(media.matches);
    update();
    media.addEventListener("change", update);
    onCleanup(() => media.removeEventListener("change", update));
  });
  createEffect(() => {
    html();
    const isLight = light();
    const element = root;
    if (!element) return;
    let active = true;
    // Debounce streamed tokens rather than rendering every partial diagram.
    const timer = setTimeout(() => {
      void renderMermaid(element, isLight, () => active);
    }, 500);
    onCleanup(() => {
      active = false;
      clearTimeout(timer);
    });
  });
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: handles in-message heading anchors, not app navigation
    // biome-ignore lint/a11y/useKeyWithClickEvents: native anchors already support keyboard activation
    <div
      class="markdown-body"
      ref={(element) => {
        root = element;
        props.onMount?.(element);
      }}
      // eslint-disable-next-line solid/no-innerhtml -- intentional: MarkdownIt has raw HTML disabled
      innerHTML={html()}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const href = target.closest("a[href]")?.getAttribute("href");
        if (!href?.startsWith("#")) return;
        // Fragment-only links target this Markdown body, not the app's session hash.
        event.preventDefault();
        try {
          const fragment = decodeURIComponent(href.slice(1));
          for (const heading of event.currentTarget.querySelectorAll("[id]")) {
            if (heading.id === fragment)
              heading.scrollIntoView({ block: "start", behavior: "smooth" });
          }
        } catch {
          // Ignore a malformed anchor rather than navigating away from the session.
        }
      }}
    />
  );
}
