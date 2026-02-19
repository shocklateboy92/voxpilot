/**
 * Touch gesture detection for swipe navigation.
 *
 * Framework-agnostic — returns a cleanup function.
 * Detects horizontal swipes on an element, excluding
 * touches near screen edges (to avoid Safari back/forward).
 */

export interface SwipeCallbacks {
  /** Called during a committed horizontal swipe with the current X delta. */
  onSwipeMove: (deltaX: number) => void;
  /** Swipe completed to the left (next session). */
  onSwipeLeft: () => void;
  /** Swipe completed to the right (prev session). */
  onSwipeRight: () => void;
  /** Swipe cancelled — snap back. */
  onSwipeCancel: () => void;
}

/** Configuration. */
const EDGE_ZONE = 25; // px — ignore touches starting this close to screen edge
const COMMIT_THRESHOLD = 80; // px — minimum distance to commit a swipe
const AXIS_LOCK_THRESHOLD = 10; // px — movement before we decide horizontal vs vertical
const VELOCITY_THRESHOLD = 0.3; // px/ms — minimum velocity to commit a shorter swipe

/**
 * Attach swipe handlers to an element.
 *
 * @returns A cleanup function that removes all event listeners.
 */
export function attachSwipeHandler(
  element: HTMLElement,
  callbacks: SwipeCallbacks,
): () => void {
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let tracking = false; // we're watching this touch
  let committed = false; // axis locked to horizontal
  let rejected = false; // axis locked to vertical (ignore)

  function onTouchStart(e: TouchEvent): void {
    const touch = e.touches[0];
    if (!touch) return;

    // Ignore touches near screen edges (Safari back/forward zone)
    if (touch.clientX < EDGE_ZONE || touch.clientX > window.innerWidth - EDGE_ZONE) {
      return;
    }

    startX = touch.clientX;
    startY = touch.clientY;
    startTime = Date.now();
    tracking = true;
    committed = false;
    rejected = false;
  }

  function onTouchMove(e: TouchEvent): void {
    if (!tracking || rejected) return;

    const touch = e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Decide axis lock
    if (!committed) {
      if (absDx > AXIS_LOCK_THRESHOLD || absDy > AXIS_LOCK_THRESHOLD) {
        if (absDx > absDy) {
          committed = true;
        } else {
          rejected = true;
          return;
        }
      } else {
        return; // not enough movement yet
      }
    }

    // Prevent vertical scroll while swiping horizontally
    e.preventDefault();
    callbacks.onSwipeMove(dx);
  }

  function onTouchEnd(e: TouchEvent): void {
    if (!tracking || !committed) {
      tracking = false;
      return;
    }

    const touch = e.changedTouches[0];
    if (!touch) {
      tracking = false;
      callbacks.onSwipeCancel();
      return;
    }

    const dx = touch.clientX - startX;
    const elapsed = Date.now() - startTime;
    const velocity = Math.abs(dx) / Math.max(elapsed, 1);
    const absDx = Math.abs(dx);

    tracking = false;

    if (absDx >= COMMIT_THRESHOLD || (absDx > 30 && velocity > VELOCITY_THRESHOLD)) {
      if (dx < 0) {
        callbacks.onSwipeLeft();
      } else {
        callbacks.onSwipeRight();
      }
    } else {
      callbacks.onSwipeCancel();
    }
  }

  function onTouchCancel(): void {
    if (tracking && committed) {
      callbacks.onSwipeCancel();
    }
    tracking = false;
  }

  // Use passive: false on touchmove so we can preventDefault
  element.addEventListener("touchstart", onTouchStart, { passive: true });
  element.addEventListener("touchmove", onTouchMove, { passive: false });
  element.addEventListener("touchend", onTouchEnd, { passive: true });
  element.addEventListener("touchcancel", onTouchCancel, { passive: true });

  return () => {
    element.removeEventListener("touchstart", onTouchStart);
    element.removeEventListener("touchmove", onTouchMove);
    element.removeEventListener("touchend", onTouchEnd);
    element.removeEventListener("touchcancel", onTouchCancel);
  };
}
