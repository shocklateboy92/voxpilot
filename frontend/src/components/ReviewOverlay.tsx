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

import { createEffect, createSignal, onCleanup, Show } from "solid-js";

/** What the overlay needs to display a single file diff. */
export interface ReviewRequest {
  from: string;
  to: string;
  filePath: string;
}

// Shared signal — set by ChangesetCard, consumed by this overlay
export const [reviewFile, setReviewFile] = createSignal<ReviewRequest | null>(
  null,
);

export function ReviewOverlay() {
  const [diffHtml, setDiffHtml] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  const CHAR_WIDTH = 7.2;

  async function loadDiff(req: ReviewRequest, width: number): Promise<void> {
    setLoading(true);
    setDiffHtml(null);

    const printWidth = Math.max(40, Math.floor(width / CHAR_WIDTH));

    try {
      const res = await fetch("/api/review/ref-diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: req.from,
          to: req.to,
          filePath: req.filePath,
          printWidth,
        }),
      });

      if (!res.ok) {
        setDiffHtml(
          `<div class="error">Failed to load diff: ${String(res.status)}</div>`,
        );
        return;
      }

      const data = (await res.json()) as { html: string };
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
    void loadDiff(req, containerRef.clientWidth);
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
          void loadDiff(req, containerRef.clientWidth);
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
              <button class="review-close" onClick={close}>
                {"\u2715"}
              </button>
            </div>
            <Show when={loading()}>
              <div class="review-loading">Formatting...</div>
            </Show>
            <Show when={diffHtml()}>
              {(html) => <div class="review-diff" innerHTML={html()} />}
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
