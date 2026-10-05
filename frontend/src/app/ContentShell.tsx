/**
 * ContentShell — shared layout shell with floating status bar at top,
 * swipeable scrollable content area, optional above-input slot, and
 * floating chat input at bottom.
 *
 * Used by ChatView (active session) and ReviewOverlay.
 */

import type { JSX } from "solid-js";
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

  /** CSS class applied to the SwipeablePane's scrollable container. */
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
          canSwipeLeft={props.canSwipeLeft}
          canSwipeRight={props.canSwipeRight}
          onSwipeLeft={props.onSwipeLeft}
          onSwipeRight={props.onSwipeRight}
          onMount={props.onPaneMount}
          onScroll={props.onScroll}
        >
          {props.children}
        </SwipeablePane>
      </div>
      <div class="absolute inset-x-3 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+0.75rem)] z-40 flex flex-col items-center gap-2">
        {props.composerOverlay}
        {props.aboveInput}
        <ChatInput onSend={props.onSend} />
      </div>
    </>
  );
}
