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
  const [isAtBottom, setIsAtBottom] = createSignal(true);

  let contentEl: HTMLElement | undefined;
  let restoreTarget: number | null = null;

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

  function setRestoreTarget(scrollTop: number): void {
    restoreTarget = scrollTop;
  }

  function clearRestoreTarget(): void {
    restoreTarget = null;
  }

  // Auto-scroll when content height grows while pinned to bottom,
  // OR scroll to a restore target if one is pending.
  createEffect(() => {
    const el = paneEl();
    if (!el || !contentEl) return;

    let lastScrollHeight = el.scrollHeight;
    const observer = new ResizeObserver(() => {
      const grew = el.scrollHeight > lastScrollHeight;
      lastScrollHeight = el.scrollHeight;

      if (!grew) return;

      if (restoreTarget !== null) {
        // Keep scrolling to the restore target on every growth until
        // scrollHeight is large enough to actually reach it.
        el.scrollTo({ top: restoreTarget, behavior: "instant" });
        if (el.scrollHeight >= restoreTarget + el.clientHeight) {
          // Content is tall enough — target is reachable, we're done.
          restoreTarget = null;
        }
        // Update isAtBottom after restore scroll
        setIsAtBottom(checkAtBottom(el));
        return;
      }

      if (isAtBottom()) {
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
    setRestoreTarget,
    clearRestoreTarget,
  };
}
