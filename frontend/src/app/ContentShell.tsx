/**
 * ContentShell — shared layout shell with floating status bar at top,
 * swipeable scrollable content area, optional above-input slot, and
 * floating chat input at bottom.
 *
 * Used by ChatView, ReviewOverlay, and the read-only Markdown viewer.
 */

import { createEffect, createSignal, type JSX, onCleanup } from "solid-js";
import { ChatInput } from "../features/chat/ChatInput";
import { SwipeablePane } from "../ui/SwipeablePane";

export interface ContentShellProps {
  /** Content rendered on the left side of the floating status bar. */
  statusBarLeft: JSX.Element;
  /** Content rendered on the right side of the floating status bar. */
  statusBarRight: JSX.Element;

  /** Can the user swipe left? */
  canSwipeLeft: () => boolean;
  /** Can the user swipe right? */
  canSwipeRight: () => boolean;
  /** Called when a left swipe commits. */
  onSwipeLeft?: () => void;
  /** Called when a right swipe commits. */
  onSwipeRight?: () => void;

  /** Pane classes; the shell owns bottom padding for its floating composer. */
  paneClass?: string;
  /** Ref callback — receives the SwipeablePane's container element after mount. */
  onPaneMount?: (el: HTMLDivElement) => void;
  /** Scroll event handler forwarded to the SwipeablePane's scrollable container. */
  onScroll?: (e: Event) => void;

  /**
   * Optional floating elements rendered inside content-shell-body but
   * above the scrollable pane (e.g. scroll-to-bottom button).
   * Positioned absolutely relative to content-shell-body.
   */
  overlay?: JSX.Element;

  /** Optional slot rendered between the content and the chat input (e.g. AgentPicker). */
  aboveInput?: JSX.Element;
  /** Optional element rendered at the top of the composer stack (e.g. scroll button). */
  composerOverlay?: JSX.Element;
  /** Optional callback fired after a message is sent from the chat input. */
  onSend?: () => void;

  /** The scrollable content. */
  children: JSX.Element;
}

export function ContentShell(props: ContentShellProps) {
  let composer: HTMLDivElement | undefined;
  const [pane, setPane] = createSignal<HTMLDivElement>();
  const [bottomClearance, setBottomClearance] = createSignal(0);

  createEffect(() => {
    const element = pane();
    const stack = composer;
    if (!stack || !element) return;
    const measure = () => {
      const pinned =
        element.scrollHeight > element.clientHeight &&
        element.scrollHeight - element.scrollTop - element.clientHeight <= 2;
      const clearance =
        Math.max(
          0,
          element.getBoundingClientRect().bottom -
            stack.getBoundingClientRect().top,
        ) + 16;
      setBottomClearance(clearance);
      if (pinned) element.scrollTop = element.scrollHeight;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stack);
    observer.observe(element);
    const insetsObserver = new MutationObserver(measure);
    insetsObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    measure();
    // Focus can change safe-area/nav insets without changing the input's size.
    window.addEventListener("resize", measure);
    document.addEventListener("focusin", measure);
    document.addEventListener("focusout", measure);
    onCleanup(() => {
      observer.disconnect();
      insetsObserver.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("focusin", measure);
      document.removeEventListener("focusout", measure);
    });
  });

  return (
    <>
      <div
        data-status-bar
        class="absolute inset-x-3 top-[calc(var(--safe-top)+1.5rem)] z-40 flex min-h-(--status-bar-height) items-center justify-between gap-3 rounded-[0.6rem] bg-glass px-3.5 py-1.5 backdrop-blur-md"
      >
        <div class="flex min-w-0 max-w-[60%] flex-[0_1_auto] items-center gap-1.5 font-mono text-xs whitespace-nowrap text-muted">
          {props.statusBarLeft}
        </div>
        <div class="flex min-w-0 flex-[0_1_auto] items-center">
          {props.statusBarRight}
        </div>
      </div>
      <div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden mask-[linear-gradient(to_bottom,transparent,black_1rem,black_calc(100%_-_1rem),transparent)]">
        {props.overlay}
        <SwipeablePane
          class={props.paneClass}
          style={{ "padding-bottom": `${bottomClearance()}px` }}
          canSwipeLeft={props.canSwipeLeft}
          canSwipeRight={props.canSwipeRight}
          onSwipeLeft={props.onSwipeLeft}
          onSwipeRight={props.onSwipeRight}
          onMount={(element) => {
            setPane(element);
            props.onPaneMount?.(element);
          }}
          onScroll={props.onScroll}
        >
          {props.children}
        </SwipeablePane>
      </div>
      <div
        ref={composer}
        data-composer-stack
        class="absolute inset-x-3 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+0.75rem)] z-40 flex flex-col items-center gap-2"
      >
        {props.composerOverlay}
        {props.aboveInput}
        <ChatInput onSend={props.onSend} />
      </div>
    </>
  );
}
