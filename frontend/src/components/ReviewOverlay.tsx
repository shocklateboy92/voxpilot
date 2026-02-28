/**
 * Review overlay — fullscreen diff viewer for git ref-based diffs.
 *
 * Flow:
 * 1. User clicks a file in ChangesetCard -> setReviewFile() called
 * 2. Overlay opens, measures container width -> calculates printWidth
 * 3. POST /api/review/ref-diff -> gets formatted HTML
 * 4. Renders HTML diff
 * 5. Resize re-renders at correct width
 */

import { X } from "lucide-solid";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { rpc } from "../rpc";

/** What the overlay needs to display a single file diff. */
export interface ReviewRequest {
  fromRef: string;
  toRef: string;
  repoRoot: string;
  filePath: string;
  cacheId?: string;
}

// Shared signal — set by ChangesetCard, consumed by this overlay
export const [reviewFile, setReviewFile] = createSignal<ReviewRequest | null>(
  null,
);

export function ReviewOverlay() {
  const [diffHtml, setDiffHtml] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  async function loadDiff(req: ReviewRequest, printWidth: number): Promise<void> {
    setLoading(true);
    setDiffHtml(null);

    try {
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
        setDiffHtml(
          `<div class="error">Failed to load diff: ${String(res.status)}</div>`,
        );
        return;
      }

      const data = await res.json();
      setDiffHtml(data.html);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setDiffHtml(`<div class="error">Error: ${msg}</div>`);
    } finally {
      setLoading(false);
    }
  }

  // Load diff when file changes
  createEffect(() => {
    const req = reviewFile();
    if (!req || !containerRef) return;
    void loadDiff(req, computePrintWidth(containerRef));
  });

  // Re-fetch on resize
  createEffect(() => {
    const req = reviewFile();
    if (!req || !containerRef) return;

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (containerRef && req) {
          void loadDiff(req, computePrintWidth(containerRef));
        }
      }, 500);
    });

    observer.observe(containerRef);
    onCleanup(() => observer.disconnect());
  });

  function close(): void {
    setReviewFile(null);
    setDiffHtml(null);
  }

  return (
    <Show when={reviewFile()}>
      {(req) => (
        <div class="review-overlay" onClick={close}>
          <div
            class="review-content"
            ref={containerRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="review-header">
              <span class="review-file-path">{req().filePath}</span>
              <button class="btn btn-ghost" onClick={close}>
                <X size={18} />
              </button>
            </div>
            <Show when={loading()}>
              <div class="review-loading">Formatting...</div>
            </Show>
            <Show when={diffHtml()}>
              {(html) => (
                <div class="review-diff-container" innerHTML={html()} />
              )}
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
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

  const availableWidth =
    container.clientWidth - gutterWidth - contentPadding;

  return Math.max(40, Math.floor(availableWidth / charWidth));
}
