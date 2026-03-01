/**
 * useScrollAnchor — reactive primitive that tracks whether a scrollable
 * container is pinned to the bottom and auto-scrolls when content grows.
 *
 * Designed to be called at module level or inside a component. Returns
 * signals and callbacks that can be wired into ContentShell / SwipeablePane.
 *
 * Usage:
 *   const anchor = useScrollAnchor();
 *   // pass anchor.onPaneMount to ContentShell's onPaneMount
 *   // pass anchor.onScroll to ContentShell's onScroll
 *   // read anchor.isAtBottom() for UI (scroll button visibility)
 *   // call anchor.scrollToBottom() to programmatically scroll
 *   // call anchor.suppress(true/false) to pause auto-scroll during restore
 */

import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

const AT_BOTTOM_THRESHOLD = 50;

export interface ScrollAnchor {
  /** Whether the scroll container is currently at (or near) the bottom. */
  isAtBottom: Accessor<boolean>;

  /** Smoothly scroll the container to the bottom. */
  scrollToBottom: () => void;

  /** Instantly scroll the container to the bottom (no animation). */
  scrollToBottomInstant: () => void;

  /**
   * Handle scroll events from the pane. Pass as ContentShell's `onScroll`.
   * Updates `isAtBottom` on every scroll.
   */
  onScroll: (e: Event) => void;

  /**
   * Receive the pane element after mount. Pass as ContentShell's `onPaneMount`.
   * Sets up the ResizeObserver for auto-scroll on content growth.
   */
  onPaneMount: (el: HTMLDivElement) => void;

  /**
   * Set a content element to observe for height changes (ResizeObserver).
   * Call with a ref to the content wrapper inside the scrollable pane.
   */
  observeContent: (el: HTMLElement) => void;

  /**
   * Suppress auto-scrolling temporarily (e.g. during scroll position restore).
   * When suppressed, content growth will not trigger auto-scroll.
   */
  setSuppressed: (value: boolean) => void;

  /** Whether auto-scroll is currently suppressed. */
  suppressed: Accessor<boolean>;
}

export function useScrollAnchor(): ScrollAnchor {
  const [paneEl, setPaneEl] = createSignal<HTMLDivElement | undefined>();
  const [isAtBottom, setIsAtBottom] = createSignal(true);
  const [suppressed, setSuppressed] = createSignal(false);

  let contentEl: HTMLElement | undefined;

  function checkAtBottom(el: HTMLElement): boolean {
    return (
      el.scrollTop + el.clientHeight >= el.scrollHeight - AT_BOTTOM_THRESHOLD
    );
  }

  function onScroll(e: Event): void {
    const el = e.currentTarget;
    if (el instanceof HTMLElement) {
      setIsAtBottom(checkAtBottom(el));
    }
  }

  function onPaneMount(el: HTMLDivElement): void {
    setPaneEl(el);
  }

  function observeContent(el: HTMLElement): void {
    contentEl = el;
  }

  function scrollToBottom(): void {
    const el = paneEl();
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  function scrollToBottomInstant(): void {
    const el = paneEl();
    el?.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  }

  // Auto-scroll when content height grows while pinned to bottom.
  createEffect(() => {
    const el = paneEl();
    if (!el || !contentEl) return;

    let lastScrollHeight = el.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (suppressed()) return;
      const grew = el.scrollHeight > lastScrollHeight;
      lastScrollHeight = el.scrollHeight;
      if (grew && isAtBottom()) {
        el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
      }
    });

    observer.observe(contentEl);
    onCleanup(() => observer.disconnect());
  });

  return {
    isAtBottom,
    scrollToBottom,
    scrollToBottomInstant,
    onScroll,
    onPaneMount,
    observeContent,
    setSuppressed,
    suppressed,
  };
}
