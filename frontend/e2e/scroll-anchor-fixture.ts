import { createEffect, createRoot } from "solid-js";
import { useScrollAnchor } from "../src/features/chat/scroll-anchor";

export function mount() {
  const pane = document.querySelector('[role="main"]');
  const content = document.querySelector("article");
  const output = document.querySelector("output");
  const button = document.querySelector("button");
  if (!(pane instanceof HTMLDivElement) || !content || !output || !button)
    throw new Error("Missing scroll fixture elements");
  createRoot(() => {
    const anchor = useScrollAnchor();
    pane.addEventListener("scroll", anchor.onScroll);
    anchor.onPaneMount(pane);
    anchor.observeContent(content);
    button.addEventListener("click", anchor.scrollToBottom);
    document.addEventListener("restore-position", (event) => {
      if (event instanceof CustomEvent && typeof event.detail === "number")
        anchor.setRestoreTarget(event.detail);
    });
    createEffect(() => {
      output.textContent = anchor.isAtBottom() ? "following" : "reading";
    });
  });
}
