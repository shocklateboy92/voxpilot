/**
 * SwipeablePane — wraps content in a horizontally-swipeable container
 * with arrow indicators and snap-back animation.
 *
 * Encapsulates all swipe gesture wiring, damping, transition handling,
 * and chevron rendering so consumers only supply navigation predicates
 * and callbacks.
 */

import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import { attachSwipeHandler } from "../gestures";

export interface SwipeablePaneProps {
  /** Can the user swipe left (toward "next"/older)? */
  canSwipeLeft: () => boolean;
  /** Can the user swipe right (toward "prev"/newer)? */
  canSwipeRight: () => boolean;
  /** Called when a left swipe commits. */
  onSwipeLeft?: () => void;
  /** Called when a right swipe commits. */
  onSwipeRight?: () => void;
  /** CSS class applied to the swipeable content container. */
  class?: string;
  /** Content to render inside the swipeable area. */
  children: JSX.Element;
  /**
   * Optional callback invoked with the content container element after mount.
   * Useful when the parent needs a ref to the swipeable element (e.g. for
   * scroll position tracking).
   */
  onMount?: (el: HTMLDivElement) => void;
  /** Optional scroll event handler forwarded to the scrollable container. */
  onScroll?: (e: Event) => void;
}

export function SwipeablePane(props: SwipeablePaneProps) {
  let containerRef: HTMLDivElement | undefined;

  const [swipeOffset, setSwipeOffset] = createSignal(0);
  const [animateSnap, setAnimateSnap] = createSignal(false);
  let pendingNav: (() => void) | null = null;

  function handleTransitionEnd(): void {
    setAnimateSnap(false);
    if (pendingNav) {
      const nav = pendingNav;
      pendingNav = null;
      nav();
    }
  }

  onMount(() => {
    if (!containerRef) {
      throw new Error("SwipeablePane mounted without containerRef being set");
    }

    props.onMount?.(containerRef);

    const cleanup = attachSwipeHandler(containerRef, {
      onSwipeMove(deltaX) {
        setAnimateSnap(false);
        pendingNav = null;
        const damped =
          Math.sign(deltaX) * Math.min(Math.sqrt(Math.abs(deltaX)) * 5, 100);
        setSwipeOffset(damped);
      },
      onSwipeLeft() {
        if (props.canSwipeLeft()) {
          pendingNav = props.onSwipeLeft ?? null;
        }
        setAnimateSnap(true);
        setSwipeOffset(0);
      },
      onSwipeRight() {
        if (props.canSwipeRight()) {
          pendingNav = props.onSwipeRight ?? null;
        }
        setAnimateSnap(true);
        setSwipeOffset(0);
      },
      onSwipeCancel() {
        setAnimateSnap(true);
        setSwipeOffset(0);
      },
    });

    onCleanup(cleanup);
  });

  const showLeftArrow = () => swipeOffset() > 0 && props.canSwipeRight();
  const showRightArrow = () => swipeOffset() < 0 && props.canSwipeLeft();
  const arrowOpacity = () => Math.min(Math.abs(swipeOffset()) / 60, 1);

  return (
    <>
      <Show when={showLeftArrow()}>
        <div
          class="swipe-arrow swipe-arrow-left"
          style={{ opacity: arrowOpacity() }}
          aria-hidden="true"
        >
          <ChevronLeft size={24} />
        </div>
      </Show>
      <Show when={showRightArrow()}>
        <div
          class="swipe-arrow swipe-arrow-right"
          style={{ opacity: arrowOpacity() }}
          aria-hidden="true"
        >
          <ChevronRight size={24} />
        </div>
      </Show>
      <div
        ref={containerRef}
        class={props.class}
        style={{
          transform: `translateX(${swipeOffset()}px)`,
          transition: animateSnap() ? "transform 200ms ease-out" : "none",
        }}
        onTransitionEnd={handleTransitionEnd}
        onScroll={(e) => props.onScroll?.(e)}
      >
        {props.children}
      </div>
    </>
  );
}
