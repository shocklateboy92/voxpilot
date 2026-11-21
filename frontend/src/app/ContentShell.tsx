/**
 * ContentShell — floating status bar and swipeable content pane, with scroll
 * clearance for the session footer owned by ChatView.
 *
 * Used by ChatView, ReviewOverlay, and the read-only file viewer.
 */

import { createEffect, createSignal, type JSX } from "solid-js";
import type { ReadingControls } from "../features/chat/reading-controls";
import { StatusBar } from "../ui/StatusBar";
import { SwipeablePane } from "../ui/SwipeablePane";

export interface ContentShellProps {
  /** Content rendered on the left side of the floating status bar. */
  statusBarLeft: JSX.Element;
  /** Content rendered on the right side of the floating status bar. */
  statusBarRight: JSX.Element;
  /** Optional expanded details for the floating summary. */
  statusBarDetails?: JSX.Element;
  /** Independent status-bar buttons, outside the details disclosure. */
  statusBarActions?: JSX.Element;
  statusBarLabel?: string;

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
  composerHeight: number;
  /** Ref callback — receives the SwipeablePane's container element after mount. */
  onPaneMount?: (el: HTMLDivElement) => void;
  /** Scroll event handler forwarded to the SwipeablePane's scrollable container. */
  onScroll?: (e: Event) => void;

  readingControls?: ReadingControls;

  /** The scrollable content. */
  children: JSX.Element;
}

export function ContentShell(props: ContentShellProps) {
  const reading = () => props.readingControls?.reading ?? false;
  const [pane, setPane] = createSignal<HTMLDivElement>();

  createEffect(() => {
    const height = props.composerHeight;
    const element = pane();
    if (!element) return;
    // Measure against the old padding before changing the scroll range.
    const range = element.scrollHeight - element.clientHeight;
    const pinned = range > 0 && range - element.scrollTop <= 2;
    element.style.setProperty("--composer-height", `${height}px`);
    if (pinned)
      element.scrollTo({ top: element.scrollHeight, behavior: "instant" });
  });

  return (
    <>
      <StatusBar
        left={props.statusBarLeft}
        right={props.statusBarRight}
        details={props.statusBarDetails}
        actions={props.statusBarActions}
        label={props.statusBarLabel}
      />
      <div
        class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        classList={{
          "mask-[linear-gradient(to_bottom,transparent,black_1rem)]": reading(),
          "mask-[linear-gradient(to_bottom,transparent,black_1rem,black_calc(100%_-_1rem),transparent)]":
            !reading(),
        }}
      >
        <SwipeablePane
          class={props.paneClass}
          style={{
            "padding-bottom":
              "calc(var(--composer-height, 0px) + var(--composer-scroll-inset, 0px) + 1.75rem)",
          }}
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
    </>
  );
}
