import type { JSX } from "solid-js";
import { renderMarkdown } from "./markdown";

/** Shared typography and touch handling for generated Markdown. */
export function MarkdownView(props: {
  text: string;
  resolveLink?: Parameters<typeof renderMarkdown>[1];
  onMount?: (element: HTMLDivElement) => void;
  onClick?: JSX.EventHandler<HTMLDivElement, MouseEvent>;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: delegates native link clicks from generated Markdown
    // biome-ignore lint/a11y/useKeyWithClickEvents: native anchors already support keyboard activation
    <div
      class="markdown-body"
      ref={(element) => props.onMount?.(element)}
      onClick={(event) => {
        props.onClick?.(event);
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
      onTouchStart={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".scroll-wrapper")) {
          event.stopPropagation();
        }
      }}
      // eslint-disable-next-line solid/no-innerhtml -- intentional: MarkdownIt has raw HTML disabled
      innerHTML={renderMarkdown(props.text, props.resolveLink)}
    />
  );
}
