/**
 * Review overlay — fullscreen diff viewer for git ref-based diffs.
 *
 * Flow:
 * 1. User opens or resumes a snapshot file
 * 2. Overlay opens with ContentShell (floating status bar + diff)
 * 3. Measures container width -> calculates printWidth
 * 4. Plugin formatComparison RPC -> gets width-formatted HTML
 * 5. Renders HTML diff; resize re-renders at correct width
 *
 * Swipe navigation:
 * - Swipe left → scroll to next change region, then next file
 * - Swipe right → scroll to previous change region, then previous file
 * - Current change is highlighted with a left-border accent
 * - Status bar shows "change N of M" counter
 */

import { MAX_PRINT_WIDTH } from "@plugin/rpc";
import X from "lucide-solid/icons/x";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { ContentShell } from "../../app/ContentShell";
import { rpc } from "../../platform/rpc";
import { observePrintWidth } from "../../ui/code-print-width";
import { IconButton } from "../../ui/IconButton";
import { Spinner } from "../../ui/Spinner";
import type { ReadingControls } from "../chat/reading-controls";
import {
  getReviewPosition,
  parkReview,
  reviewFile,
  saveReviewPosition,
  selectReviewFile,
} from "./review-navigation";

/** Padding (px) above a change region when it doesn't fit on screen. */
const SCROLL_TOP_PADDING = 32;

/** CSS class applied to rows belonging to the current change region. */
const CURRENT_CHANGE_CLASS = "current-change";

/** Diffs stay readable by scrolling rather than wrapping below this width. */
const MIN_REVIEW_COLUMNS = 40;

export function ReviewOverlay(props: {
  composerHeight: number;
  readingControls: ReadingControls;
}) {
  let containerRef: HTMLElement | undefined;
  let paneRef: HTMLDivElement | undefined;
  const [printWidth, setPrintWidth] = createSignal<number | undefined>();

  const open = createMemo(() => Boolean(reviewFile()));
  createEffect(() => {
    if (!open()) return;
    const previous = document.activeElement;
    containerRef?.focus();
    onCleanup(() => {
      queueMicrotask(() => {
        if (
          !untrack(open) &&
          previous instanceof HTMLElement &&
          previous.isConnected
        )
          previous.focus();
      });
    });
  });

  // Explicit index of the current change region (0-based).
  // -1 means "no region selected yet" (before first navigation).
  const [currentIndex, setCurrentIndex] = createSignal(-1);
  // Total number of change regions in the current file's rendered diff.
  const [regionCount, setRegionCount] = createSignal(0);
  const [unlocated, setUnlocated] = createSignal(false);
  const [showCurrentChange, setShowCurrentChange] = createSignal(true);

  // Cached regions array — rebuilt each time the diff HTML changes.
  let cachedRegions: HTMLElement[] = [];

  // Derive a stable fetch key from the review request + print width.
  // Returns undefined (skipping the fetch) until both are available.
  const fetchKey = () => {
    const req = reviewFile();
    const pw = printWidth();
    if (!req || !pw) return undefined;
    return { req, printWidth: pw };
  };

  const [diff] = createResource(fetchKey, async ({ req, printWidth }) => {
    const data = await rpc.formatComparison({
      filePath: req.filePath,
      printWidth,
      cacheId: req.cacheId,
      ...(req.citation ? { sourceLine: req.citation.sourceLine } : {}),
    });
    return { html: data.html, targetRow: data.targetRow, req, printWidth };
  });
  const rendered = createMemo(() => {
    if (diff.state !== "ready") return undefined;
    const result = diff();
    if (result.req === reviewFile() && result.printWidth === printWidth())
      return result;
  });
  let positioned: ReturnType<typeof rendered>;

  // Restore pixel position at the same width, or fall back to the saved change.
  createEffect(() => {
    const result = rendered();
    const pane = paneRef;
    positioned = undefined;
    cachedRegions = [];
    setCurrentIndex(-1);
    setRegionCount(0);
    setUnlocated(false);
    if (!result || !pane) return;

    // Wait one frame for innerHTML to update the DOM.
    const frame = requestAnimationFrame(() => {
      cachedRegions = getChangeRegions(pane);
      setRegionCount(cachedRegions.length);
      const saved = getReviewPosition(result.req);
      const citation = result.req.citation;
      const row = findCitationRow(pane, result.targetRow);
      const jump =
        citation &&
        (saved?.citationId !== citation.id ||
          saved.printWidth !== result.printWidth);
      const idx = jump
        ? regionIndexBefore(cachedRegions, row)
        : initialChangeIndex(
            cachedRegions.length,
            result.req.startAtEnd,
            saved?.changeIndex,
          );

      setUnlocated(Boolean(citation && !row));
      setShowCurrentChange(!citation);
      setCurrentIndex(idx);
      applyHighlight(cachedRegions, citation ? -1 : idx);

      if (jump) {
        if (row) scrollRowToThird(pane, row, props.composerHeight);
        else pane.scrollTo({ top: 0, behavior: "instant" });
      } else if (saved?.printWidth === result.printWidth) {
        pane.scrollTo({ top: saved.scrollTop, behavior: "instant" });
      } else {
        const region = cachedRegions[idx];
        if (region) scrollToRegion(region, pane, "instant");
        else pane.scrollTo({ top: 0, behavior: "instant" });
      }
      positioned = result;
      savePosition();
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  function savePosition(): void {
    const result = rendered();
    if (!result || result !== positioned || !paneRef) return;
    saveReviewPosition(result.req, {
      citationId: result.req.citation?.id,
      changeIndex: currentIndex(),
      printWidth: result.printWidth,
      scrollTop: paneRef.scrollTop,
    });
  }

  // When currentIndex changes (via swipe), update the DOM highlight.
  createEffect(() => {
    const idx = currentIndex();
    if (!paneRef || cachedRegions.length === 0) return;
    applyHighlight(cachedRegions, showCurrentChange() ? idx : -1);
  });

  createEffect(() => {
    if (!open() || !containerRef) return;
    onCleanup(
      observePrintWidth(containerRef, setPrintWidth, {
        min: MIN_REVIEW_COLUMNS,
        max: MAX_PRINT_WIDTH,
      }),
    );
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
    setShowCurrentChange(true);
    setCurrentIndex(nextIdx);
    const region = cachedRegions[nextIdx];
    if (region) {
      scrollToRegion(region, paneRef);
    }
    savePosition();
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
    setShowCurrentChange(true);
    setCurrentIndex(prevIdx);
    const region = cachedRegions[prevIdx];
    if (region) {
      scrollToRegion(region, paneRef);
    }
    savePosition();
  }

  /**
   * Navigate to a sibling file in the changeset.
   */
  function navigateToFile(delta: number, scrollTo: "first" | "last"): void {
    const req = reviewFile();
    if (!req) return;

    savePosition();
    selectReviewFile(req.fileIndex + delta, scrollTo);
  }

  // ---------------------------------------------------------------------------
  // Swipe predicates
  // ---------------------------------------------------------------------------

  function canSwipeLeft(): boolean {
    if (!rendered()) return false;
    const req = reviewFile();
    if (!req) return false;

    // Read regionCount() (signal) rather than cachedRegions.length (plain
    // array) so the predicate is reactive — SwipeablePane forwards it into
    // a JSX <Show> for the chevron arrows.
    const total = regionCount();
    const hasNextRegion = total > 0 && currentIndex() < total - 1;
    const hasNextFile = req.fileIndex < req.files.length - 1;

    return hasNextRegion || hasNextFile;
  }

  function canSwipeRight(): boolean {
    if (!rendered()) return false;
    const req = reviewFile();
    if (!req) return false;

    const hasPrevRegion = regionCount() > 0 && currentIndex() > 0;
    const hasPrevFile = req.fileIndex > 0;

    return hasPrevRegion || hasPrevFile;
  }

  // ---------------------------------------------------------------------------
  // Status bar counter
  // ---------------------------------------------------------------------------

  const changeCounter = createMemo(() => {
    const total = regionCount();
    const idx = currentIndex();
    if (total === 0 || idx < 0 || !showCurrentChange()) return null;
    return `${idx + 1} of ${total}`;
  });

  const fileCounter = createMemo(() => {
    const req = reviewFile();
    if (!req || req.files.length <= 1) return null;
    return `${req.fileIndex + 1}/${req.files.length}`;
  });

  // ---------------------------------------------------------------------------

  function close(): void {
    savePosition();
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && containerRef?.contains(focused))
      focused.blur();
    parkReview();
  }

  return (
    <Show when={reviewFile()}>
      {(req) => (
        <section
          class="review-overlay absolute inset-0 flex flex-col bg-bg text-left outline-none [--status-bar-clearance:calc(4.5rem+var(--safe-top))]"
          aria-label="File review"
          tabIndex={-1}
          ref={containerRef}
        >
          <ContentShell
            composerHeight={props.composerHeight}
            readingControls={props.readingControls}
            statusBarLabel="Review status"
            statusBarLeft={
              <span class="review-file-path min-w-0 flex-1 truncate font-mono text-xs font-semibold text-muted">
                {req().filePath}
                <Show when={fileCounter()}>
                  {(fc) => (
                    <span class="review-file-counter ml-2 text-[0.65rem] text-muted opacity-70">
                      {fc()}
                    </span>
                  )}
                </Show>
              </span>
            }
            statusBarRight={
              <Show when={changeCounter()}>
                {(cc) => (
                  <span class="font-mono text-[0.7rem] whitespace-nowrap text-muted">
                    {cc()}
                  </span>
                )}
              </Show>
            }
            statusBarActions={
              <IconButton
                variant="ghost"
                aria-label="Close review"
                onClick={close}
              >
                <X size={14} />
              </IconButton>
            }
            statusBarDetails={
              <dl class="flex min-w-0 flex-col gap-4">
                <div>
                  <dt class="mb-1 text-xs font-semibold text-muted">File</dt>
                  <dd class="font-mono select-text [overflow-wrap:anywhere]">
                    {req().filePath}
                  </dd>
                </div>
                <div>
                  <dt class="mb-1 text-xs font-semibold text-muted">
                    Repository
                  </dt>
                  <dd class="font-mono select-text [overflow-wrap:anywhere]">
                    {req().repoRoot}
                  </dd>
                </div>
                <div>
                  <dt class="mb-1 text-xs font-semibold text-muted">
                    Comparison
                  </dt>
                  <dd class="font-mono select-text [overflow-wrap:anywhere]">
                    {req().fromRef} → {req().toRef}
                  </dd>
                </div>
                <div>
                  <dt class="mb-1 text-xs font-semibold text-muted">
                    Position
                  </dt>
                  <dd>
                    File {req().fileIndex + 1} of {req().files.length}
                    <Show
                      when={changeCounter()}
                      fallback={
                        regionCount() === 0 ? " · No changes" : undefined
                      }
                    >
                      {(counter) => <> · Change {counter()}</>}
                    </Show>
                  </dd>
                </div>
              </dl>
            }
            canSwipeLeft={canSwipeLeft}
            canSwipeRight={canSwipeRight}
            onSwipeLeft={navigateNext}
            onSwipeRight={navigatePrev}
            onPaneMount={(el) => {
              paneRef = el;
            }}
            onScroll={savePosition}
            paneClass="review-pane min-h-0 flex-1 touch-pan-y overflow-x-clip overflow-y-auto pt-(--status-bar-clearance) text-left"
          >
            <Show
              when={diff.state === "errored"}
              fallback={
                <Show when={rendered()} fallback={<Spinner />}>
                  {(result) => (
                    <>
                      <Show when={unlocated()}>
                        <p role="status" class="mx-3 mb-2 text-sm text-muted">
                          Exact line not located in this diff.
                        </p>
                      </Show>
                      <div
                        class="review-diff-container min-h-0"
                        data-viewer-selection="review"
                        // eslint-disable-next-line solid/no-innerhtml -- intentional: server-rendered diff HTML
                        innerHTML={result().html}
                      />
                    </>
                  )}
                </Show>
              }
            >
              <div role="alert" class="text-error">
                {diff.error instanceof Error
                  ? diff.error.message
                  : "Unable to open this review file."}
              </div>
            </Show>
          </ContentShell>
        </section>
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

function initialChangeIndex(
  regionCount: number,
  startAtEnd: boolean,
  savedIndex?: number,
): number {
  const last = regionCount - 1;
  return Math.min(savedIndex ?? (startAtEnd ? last : 0), last);
}

function findCitationRow(
  pane: HTMLElement,
  target: Awaited<ReturnType<typeof rpc.formatComparison>>["targetRow"],
): HTMLElement | null {
  return target
    ? pane.querySelector<HTMLElement>(
        `[data-review-${target.side}="${target.line}"]`,
      )
    : null;
}

/** The last change region containing the row or preceding it in DOM order. */
function regionIndexBefore(
  regions: readonly HTMLElement[],
  row: HTMLElement | null,
): number {
  if (!row) return -1;
  let preceding = -1;
  for (const [index, region] of regions.entries()) {
    if (
      !(region.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)
    )
      break;
    preceding = index;
  }
  return preceding;
}

function scrollRowToThird(
  pane: HTMLElement,
  row: HTMLElement,
  composerHeight: number,
): void {
  const viewport = pane.getBoundingClientRect();
  const inset = Number.parseFloat(getComputedStyle(pane).paddingTop) || 0;
  const available = Math.max(0, viewport.height - inset - composerHeight);
  pane.scrollTo({
    top:
      pane.scrollTop +
      row.getBoundingClientRect().top -
      viewport.top -
      inset -
      available / 3,
    behavior: "instant",
  });
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
function scrollToRegion(
  region: HTMLElement,
  pane: HTMLElement,
  behavior: ScrollBehavior = "smooth",
): void {
  const rect = region.getBoundingClientRect();
  const paneRect = pane.getBoundingClientRect();
  const viewportHeight = paneRect.height;

  if (rect.height <= viewportHeight) {
    // Region fits on screen — center it
    const regionCenter =
      rect.top - paneRect.top + pane.scrollTop + rect.height / 2;
    pane.scrollTo({
      top: regionCenter - viewportHeight / 2,
      behavior,
    });
  } else {
    // Region too tall — position near the top
    const targetTop =
      rect.top - paneRect.top + pane.scrollTop - SCROLL_TOP_PADDING;
    pane.scrollTo({
      top: targetTop,
      behavior,
    });
  }
}
