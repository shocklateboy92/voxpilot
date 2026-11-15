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
 *   // call anchor.setRestoreTarget(scrollTop) to restore a reading position
 */

import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

const AT_BOTTOM_THRESHOLD = 50;

export interface ScrollAnchor {
  /** Whether the pane is following the bottom (including a smooth jump there). */
  isAtBottom: Accessor<boolean>;

  /** Smoothly scroll the container to the bottom. */
  scrollToBottom: () => void;

  /** Instantly scroll the container to the bottom (no animation). */
  scrollToBottomInstant: () => void;

  /**
   * Handle scroll events from the pane. Pass as ContentShell's `onScroll`.
   * Distinguishes scrolling away from layout changes and our own scrolling.
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
   * Set a scroll-position restore target. While set, the ResizeObserver
   * scrolls to this position (instead of bottom) on every content growth,
   * until scrollHeight is large enough to reach the target. Once reached,
   * the target is cleared automatically.
   *
   * This solves the race between scroll restore and incremental DOM
   * rendering — the ResizeObserver keeps retrying until the full content
   * is laid out.
   */
  setRestoreTarget: (scrollTop: number) => void;

  /** Clear any pending restore target (e.g. if the session changes again). */
  clearRestoreTarget: () => void;
}

export function useScrollAnchor(): ScrollAnchor {
  const [paneEl, setPaneEl] = createSignal<HTMLDivElement | undefined>();
  const [contentEl, setContentEl] = createSignal<HTMLElement | undefined>();
  const [isAtBottom, setIsAtBottom] = createSignal(true);

  let restoreTarget: number | null = null;
  let lastScrollTop = 0;

  function scrollRange(el: HTMLElement): number {
    return Math.max(0, el.scrollHeight - el.clientHeight);
  }

  function rememberPosition(el: HTMLElement): void {
    lastScrollTop = el.scrollTop;
  }

  function checkAtBottom(el: HTMLElement): boolean {
    return (
      el.scrollTop + el.clientHeight >= el.scrollHeight - AT_BOTTOM_THRESHOLD
    );
  }

  function onScroll(e: Event): void {
    const el = e.currentTarget;
    if (el instanceof HTMLElement) {
      // Scroll events can arrive BEFORE ResizeObserver. Compare positions, not
      // just today's distance from the bottom: growth isn't user intent, and
      // collapse can clamp scrollTop to the new range. Any further upward
      // movement is scrolling away, even if content grew in this frame.
      // Downward smooth-scroll frames must
      // not cancel a deliberate jump before it gets to the bottom.
      const layoutTop = Math.min(lastScrollTop, scrollRange(el));
      if (el.scrollTop < layoutTop - 1) {
        setIsAtBottom(checkAtBottom(el));
      } else if (el.scrollTop > lastScrollTop + 1 && checkAtBottom(el)) {
        setIsAtBottom(true);
      }
      rememberPosition(el);
    }
  }

  function onPaneMount(el: HTMLDivElement): void {
    rememberPosition(el);
    setPaneEl(el);
  }

  function observeContent(el: HTMLElement): void {
    setContentEl(el);
  }

  function scrollToBottom(): void {
    restoreTarget = null;
    setIsAtBottom(true);
    const el = paneEl();
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  function scrollToBottomInstant(): void {
    restoreTarget = null;
    setIsAtBottom(true);
    const el = paneEl();
    el?.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    if (el) rememberPosition(el);
  }

  function setRestoreTarget(scrollTop: number): void {
    restoreTarget = scrollTop;
    setIsAtBottom(false);
    const el = paneEl();
    if (el) reconcileLayout(el);
  }

  function clearRestoreTarget(): void {
    restoreTarget = null;
  }

  function reconcileLayout(el: HTMLDivElement): void {
    if (restoreTarget !== null) {
      el.scrollTo({ top: restoreTarget, behavior: "instant" });
      if (scrollRange(el) >= restoreTarget) {
        restoreTarget = null;
        setIsAtBottom(checkAtBottom(el));
      }
    } else if (isAtBottom()) {
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    }
    rememberPosition(el);
  }

  // Follow intent survives growth AND shrinkage. Observe the pane too: the
  // keyboard, viewport, and composer clearance can change the scroll range
  // without changing the message wrapper's height.
  createEffect(() => {
    const el = paneEl();
    const content = contentEl();
    if (!el || !content) return;

    const observer = new ResizeObserver(() => reconcileLayout(el));
    observer.observe(content);
    observer.observe(el);
    onCleanup(() => {
      observer.disconnect();
    });
  });

  return {
    isAtBottom,
    scrollToBottom,
    scrollToBottomInstant,
    onScroll,
    onPaneMount,
    observeContent,
    setRestoreTarget,
    clearRestoreTarget,
  };
}
