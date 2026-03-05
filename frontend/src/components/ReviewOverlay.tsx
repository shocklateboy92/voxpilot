/**
 * Review overlay — fullscreen diff viewer for git ref-based diffs.
 *
 * Flow:
 * 1. User clicks a file in ChangesetCard -> setReviewFile() called
 * 2. Overlay opens with ContentShell (floating status bar + diff + input)
 * 3. Measures container width -> calculates printWidth
 * 4. POST /api/review/ref-diff -> gets formatted HTML
 * 5. Renders HTML diff; resize re-renders at correct width
 *
 * Swipe / keyboard navigation:
 * - Swipe left  / PageDown → scroll to next change region, then next file
 * - Swipe right / PageUp   → scroll to prev change region, then prev file
 * - Escape closes the overlay
 * - Current change is highlighted with a left-border accent
 * - Status bar shows "change N of M" counter
 */

import X from "lucide-solid/icons/x";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  ErrorBoundary,
  onCleanup,
  Show,
  Suspense,
} from "solid-js";
import { rpc } from "../rpc";
import { ContentShell } from "./ContentShell";
import { Spinner } from "./Spinner";

/** What the overlay needs to display a single file diff. */
export interface ReviewRequest {
  fromRef: string;
  toRef: string;
  repoRoot: string;
  filePath: string;
  cacheId?: string;
  /** All file paths in the changeset, in order. */
  files: string[];
  /** Index of the current file within `files`. */
  fileIndex: number;
}

// Shared signal — set by ChangesetCard, consumed by this overlay
export const [reviewFile, setReviewFile] = createSignal<ReviewRequest | null>(
  null,
);

/** Padding (px) above a change region when it doesn't fit on screen. */
const SCROLL_TOP_PADDING = 32;

/** CSS class applied to rows belonging to the current change region. */
const CURRENT_CHANGE_CLASS = "current-change";

export function ReviewOverlay() {
  let containerRef: HTMLDivElement | undefined;
  let paneRef: HTMLDivElement | undefined;
  const [printWidth, setPrintWidth] = createSignal<number | undefined>();

  // Explicit index of the current change region (0-based).
  // -1 means "no region selected yet" (before first navigation).
  const [currentIndex, setCurrentIndex] = createSignal(-1);
  // Total number of change regions in the current file's rendered diff.
  const [regionCount, setRegionCount] = createSignal(0);

  // Cached regions array — rebuilt each time the diff HTML changes.
  let cachedRegions: HTMLElement[] = [];

  // Direction to auto-scroll when a new file's diff renders.
  // "first" → start at first change, "last" → start at last change.
  let initialDirection: "first" | "last" = "first";

  // Version counter — incremented each time the file changes so that
  // in-flight rAF callbacks from a previous file can discard themselves.
  let regionVersion = 0;

  // Reset navigation state immediately when the file changes, before
  // the new diff HTML arrives. This prevents stale regions from a
  // previous file being used during the loading gap.
  createEffect(() => {
    reviewFile(); // track the signal
    cachedRegions = [];
    setCurrentIndex(-1);
    setRegionCount(0);
    regionVersion++;
  });

  // Derive a stable fetch key from the review request + print width.
  // Returns undefined (skipping the fetch) until both are available.
  const fetchKey = () => {
    const req = reviewFile();
    const pw = printWidth();
    if (!req || !pw) return undefined;
    return { req, printWidth: pw };
  };

  const [diffHtml] = createResource(fetchKey, async ({ req, printWidth }) => {
    const res = await rpc.api.review["ref-diff"].$post({
      json: {
        fromRef: req.fromRef,
        toRef: req.toRef,
        filePath: req.filePath,
        printWidth,
        repoRoot: req.repoRoot,
        cacheId: req.cacheId,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to load diff: ${String(res.status)}`);
    }

    const data = await res.json();
    return data.html as string;
  });

  // After diff HTML renders, scan for change regions and navigate
  // to the initial change (first or last).
  createEffect(() => {
    const html = diffHtml();
    if (!html || !paneRef) return;

    const pane = paneRef;
    const direction = initialDirection;
    initialDirection = "first";
    const version = regionVersion;

    // Wait one frame for innerHTML to update the DOM.
    requestAnimationFrame(() => {
      // Discard if a newer file change has occurred since we scheduled.
      if (version !== regionVersion) return;

      cachedRegions = getChangeRegions(pane);
      setRegionCount(cachedRegions.length);

      if (cachedRegions.length === 0) {
        setCurrentIndex(-1);
        return;
      }

      const idx = direction === "first" ? 0 : cachedRegions.length - 1;
      setCurrentIndex(idx);
      applyHighlight(cachedRegions, idx);
      const region = cachedRegions[idx];
      if (region) {
        scrollToRegion(region, pane);
      }
    });
  });

  // When currentIndex changes (via swipe), update the DOM highlight.
  createEffect(() => {
    const idx = currentIndex();
    if (!paneRef || cachedRegions.length === 0 || idx < 0) return;
    applyHighlight(cachedRegions, idx);
  });

  // Compute initial printWidth once the overlay is visible
  createEffect(() => {
    if (!reviewFile() || !containerRef) return;
    setPrintWidth(computePrintWidth(containerRef));
  });

  // Update printWidth on resize (only when width actually changes)
  createEffect(() => {
    if (!reviewFile() || !containerRef) return;

    let lastWidth = containerRef.clientWidth;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (!containerRef) return;
      const newWidth = containerRef.clientWidth;
      if (newWidth === lastWidth) return;
      lastWidth = newWidth;

      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (containerRef) {
          setPrintWidth(computePrintWidth(containerRef));
        }
      }, 500);
    });

    observer.observe(containerRef);
    onCleanup(() => observer.disconnect());
  });

  // ---------------------------------------------------------------------------
  // Change-region navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigate to the next change region within the current file.
   * If already at the last region, navigate to the next file.
   */
  function navigateNext(): void {
    if (!paneRef) return;
    const idx = currentIndex();
    const total = cachedRegions.length;

    if (total === 0 || idx >= total - 1) {
      // At or past last change — go to next file
      navigateToFile(1, "first");
      return;
    }

    const nextIdx = idx + 1;
    setCurrentIndex(nextIdx);
    const region = cachedRegions[nextIdx];
    if (region) {
      scrollToRegion(region, paneRef);
    }
  }

  /**
   * Navigate to the previous change region within the current file.
   * If already at the first region, navigate to the previous file.
   */
  function navigatePrev(): void {
    if (!paneRef) return;
    const idx = currentIndex();

    if (cachedRegions.length === 0 || idx <= 0) {
      // At or before first change — go to prev file
      navigateToFile(-1, "last");
      return;
    }

    const prevIdx = idx - 1;
    setCurrentIndex(prevIdx);
    const region = cachedRegions[prevIdx];
    if (region) {
      scrollToRegion(region, paneRef);
    }
  }

  /**
   * Navigate to a sibling file in the changeset.
   */
  function navigateToFile(delta: number, scrollTo: "first" | "last"): void {
    const req = reviewFile();
    if (!req) return;

    const newIndex = req.fileIndex + delta;
    const newPath = req.files[newIndex];
    if (newPath === undefined) return;

    initialDirection = scrollTo;
    setReviewFile({
      ...req,
      filePath: newPath,
      fileIndex: newIndex,
    });
  }

  // ---------------------------------------------------------------------------
  // Swipe predicates
  // ---------------------------------------------------------------------------

  function canSwipeLeft(): boolean {
    if (diffHtml.loading || !diffHtml()) return false;
    const req = reviewFile();
    if (!req) return false;

    const hasNextRegion =
      cachedRegions.length > 0 && currentIndex() < cachedRegions.length - 1;
    const hasNextFile = req.fileIndex < req.files.length - 1;

    return hasNextRegion || hasNextFile;
  }

  function canSwipeRight(): boolean {
    if (diffHtml.loading || !diffHtml()) return false;
    const req = reviewFile();
    if (!req) return false;

    const hasPrevRegion = cachedRegions.length > 0 && currentIndex() > 0;
    const hasPrevFile = req.fileIndex > 0;

    return hasPrevRegion || hasPrevFile;
  }

  // ---------------------------------------------------------------------------
  // Status bar counter
  // ---------------------------------------------------------------------------

  const changeCounter = createMemo(() => {
    const total = regionCount();
    if (total === 0) return null;
    const idx = currentIndex();
    return `${idx + 1} of ${total}`;
  });

  const fileCounter = createMemo(() => {
    const req = reviewFile();
    if (!req || req.files.length <= 1) return null;
    return `${req.fileIndex + 1}/${req.files.length}`;
  });

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  function handleKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case "PageDown":
        e.preventDefault();
        navigateNext();
        break;
      case "PageUp":
        e.preventDefault();
        navigatePrev();
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
    }
  }

  // ---------------------------------------------------------------------------

  function close(): void {
    setReviewFile(null);
  }

  return (
    <Show when={reviewFile()}>
      {(req) => (
        <div class="review-overlay" onClick={close} onKeyDown={handleKeyDown}>
          <div
            class="review-content"
            ref={containerRef}
            onClick={(e) => e.stopPropagation()}
          >
            <ContentShell
              statusBarLeft={
                <span class="review-file-path">
                  {req().filePath}
                  <Show when={fileCounter()}>
                    {(fc) => <span class="review-file-counter">{fc()}</span>}
                  </Show>
                </span>
              }
              statusBarRight={
                <>
                  <Show when={changeCounter()}>
                    {(cc) => <span class="review-change-counter">{cc()}</span>}
                  </Show>
                  <button class="btn btn-ghost" onClick={close}>
                    <X size={18} />
                  </button>
                </>
              }
              canSwipeLeft={canSwipeLeft}
              canSwipeRight={canSwipeRight}
              onSwipeLeft={navigateNext}
              onSwipeRight={navigatePrev}
              onPaneMount={(el) => {
                paneRef = el;
              }}
              paneClass="review-pane"
              onSend={close}
            >
              <ErrorBoundary
                fallback={(err) => (
                  <div class="review-diff-container">
                    <div class="error">
                      Error:{" "}
                      {err instanceof Error ? err.message : "Unknown error"}
                    </div>
                  </div>
                )}
              >
                <Suspense fallback={<Spinner />}>
                  {/* eslint-disable-next-line solid/no-innerhtml -- intentional: server-rendered diff HTML */}
                  <div class="review-diff-container" innerHTML={diffHtml() ?? ""} />
                </Suspense>
              </ErrorBoundary>
            </ContentShell>
          </div>
        </div>
      )}
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Change-region detection and highlight helpers
// ---------------------------------------------------------------------------

/**
 * Collect the server-rendered change-region `<tbody>` elements.
 *
 * The server wraps consecutive changed rows in
 * `<tbody class="change-region" id="cr-N">` and stamps the total
 * count on `<table data-region-count="N">`.  This means region
 * detection is a single querySelectorAll — no row-scanning needed.
 */
function getChangeRegions(pane: HTMLElement): HTMLElement[] {
  return Array.from(pane.querySelectorAll<HTMLElement>(".change-region"));
}

/**
 * Apply the current-change highlight to the given region index,
 * removing it from all other regions.  Since each region is a single
 * `<tbody>` element, this toggles one class per element rather than
 * iterating every row.
 */
function applyHighlight(regions: HTMLElement[], activeIndex: number): void {
  for (let i = 0; i < regions.length; i++) {
    regions[i]?.classList.toggle(CURRENT_CHANGE_CLASS, i === activeIndex);
  }
}

/**
 * Scroll the pane so a change region is visible.
 *
 * - If the entire region fits on screen → center it vertically.
 * - If it doesn't fit → position it near the top with padding.
 */
function scrollToRegion(region: HTMLElement, pane: HTMLElement): void {
  const rect = region.getBoundingClientRect();
  const paneRect = pane.getBoundingClientRect();
  const viewportHeight = paneRect.height;

  if (rect.height <= viewportHeight) {
    // Region fits on screen — center it
    const regionCenter =
      rect.top - paneRect.top + pane.scrollTop + rect.height / 2;
    pane.scrollTo({
      top: regionCenter - viewportHeight / 2,
      behavior: "smooth",
    });
  } else {
    // Region too tall — position near the top
    const targetTop =
      rect.top - paneRect.top + pane.scrollTop - SCROLL_TOP_PADDING;
    pane.scrollTo({
      top: targetTop,
      behavior: "smooth",
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers — print-width measurement
// ---------------------------------------------------------------------------

/**
 * Parse a CSS length value (e.g. "2.5rem", "40px") to pixels.
 * Supports rem and px units; falls back to parseFloat for unknown units.
 */
function cssToPx(value: string, rootFontSize: number): number {
  const num = parseFloat(value);
  if (value.endsWith("rem")) return num * rootFontSize;
  return num; // px or unitless
}

/**
 * Measure the width of a single monospace character in pixels using the
 * browser's own font metrics.  Uses a Canvas measureText() call with the
 * resolved font from getComputedStyle(), so it works regardless of which
 * font in the stack the browser actually picked.
 *
 * A hidden probe element styled with the same CSS custom properties as
 * `.fulltext-table` is temporarily inserted to obtain the correct
 * computed font.
 */
function measureCharWidth(container: HTMLElement): number {
  // Create a probe element that inherits the same font as .fulltext-table
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;" +
    "font-family:var(--font-mono);" +
    "font-size:var(--code-font-size);" +
    "line-height:var(--code-line-height);";
  container.appendChild(probe);

  const style = getComputedStyle(probe);
  const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

  container.removeChild(probe);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Fallback: shouldn't happen in any real browser
    return 7.2;
  }
  ctx.font = font;
  // Measure a representative character — "M" is conventional but for
  // monospace any character yields the same width.  Use "0" which is
  // guaranteed present in every font.
  return ctx.measureText("0").width;
}

/**
 * Compute how many characters fit on a single code line given the
 * container's pixel width, accounting for the line-number gutter and
 * cell padding.
 *
 * All layout values are read from CSS custom properties defined in
 * style.css (:root), so CSS and JS stay in sync automatically:
 *   --line-num-width, --cell-padding
 */
function computePrintWidth(container: HTMLElement): number {
  const charWidth = measureCharWidth(container);

  const rootFontSize = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  const rootStyles = getComputedStyle(document.documentElement);

  const lineNumWidth = cssToPx(
    rootStyles.getPropertyValue("--line-num-width").trim() || "2.5rem",
    rootFontSize,
  );
  const cellPadding = cssToPx(
    rootStyles.getPropertyValue("--cell-padding").trim() || "0.4rem",
    rootFontSize,
  );

  // Line-number column: fixed width + padding on each side
  const gutterWidth = lineNumWidth + 2 * cellPadding;
  // Code-content cell: padding on each side
  const contentPadding = 2 * cellPadding;

  const availableWidth = container.clientWidth - gutterWidth - contentPadding;

  return Math.max(40, Math.floor(availableWidth / charWidth));
}
