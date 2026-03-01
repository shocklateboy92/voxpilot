/**
 * ContentShell — shared layout shell with floating status bar at top,
 * swipeable scrollable content area, optional above-input slot, and
 * floating chat input at bottom.
 *
 * Used by ChatView (active session) and ReviewOverlay.
 */

import type { JSX } from "solid-js";
import { ChatInput } from "./ChatInput";
import { SwipeablePane } from "./SwipeablePane";

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

  /**
   * Optional floating elements rendered inside content-shell-body but
   * above the scrollable pane (e.g. scroll-to-bottom button).
   * Positioned absolutely relative to content-shell-body.
   */
  overlay?: JSX.Element;

  /** Optional slot rendered between the content and the chat input (e.g. AgentPicker). */
  aboveInput?: JSX.Element;
  /** Optional callback fired after a message is sent from the chat input. */
  onSend?: () => void;

  /** The scrollable content. */
  children: JSX.Element;
}

export function ContentShell(props: ContentShellProps) {
  return (
    <>
      <div class="status-bar">
        <div class="status-bar-left">{props.statusBarLeft}</div>
        <div class="status-bar-right">{props.statusBarRight}</div>
      </div>
      <div class="content-shell-body">
        {props.overlay}
        <SwipeablePane
          class={props.paneClass}
          canSwipeLeft={props.canSwipeLeft}
          canSwipeRight={props.canSwipeRight}
          onSwipeLeft={props.onSwipeLeft}
          onSwipeRight={props.onSwipeRight}
          onMount={props.onPaneMount}
        >
          {props.children}
        </SwipeablePane>
      </div>
      {props.aboveInput}
      <ChatInput onSend={props.onSend} />
    </>
  );
}
