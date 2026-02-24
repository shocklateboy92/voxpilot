/**
 * Review overlay — fullscreen diff viewer.
 *
 * Flow:
 * 1. User taps a file in ChangesetCard -> overlay opens
 * 2. Measures container width -> calculates printWidth
 * 3. POST /api/review/format-diff -> gets formatted HTML
 * 4. Renders HTML diff
 * 5. Viewed state stored in localStorage
 */

import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { markViewed } from "../review-state";
import { activeSessionId } from "../store";

// Shared state for what file is being reviewed (just the file path)
export const [reviewFilePath, setReviewFilePath] = createSignal<string | null>(null);

export function ReviewOverlay() {
  const [diffHtml, setDiffHtml] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  const CHAR_WIDTH = 7.2; // approximate monospace char width in px

  async function loadDiff(filePath: string, width: number): Promise<void> {
    setLoading(true);
    setDiffHtml(null);

    const sessionId = activeSessionId();
    if (!sessionId) return;

    const printWidth = Math.max(40, Math.floor(width / CHAR_WIDTH));

    try {
      const res = await fetch("/api/review/format-diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          filePath,
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

      // Mark as viewed
      markViewed(sessionId, filePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setDiffHtml(`<div class="error">Error: ${msg}</div>`);
    } finally {
      setLoading(false);
    }
  }

  // Load diff when file changes
  createEffect(() => {
    const filePath = reviewFilePath();
    if (!filePath || !containerRef) return;
    void loadDiff(filePath, containerRef.clientWidth);
  });

  // Handle resize
  createEffect(() => {
    const filePath = reviewFilePath();
    if (!filePath || !containerRef) return;

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (containerRef && filePath) {
          void loadDiff(filePath, containerRef.clientWidth);
        }
      }, 500);
    });

    observer.observe(containerRef);
    onCleanup(() => observer.disconnect());
  });

  function close(): void {
    setReviewFilePath(null);
    setDiffHtml(null);
  }

  return (
    <Show when={reviewFilePath()}>
      {(filePath) => (
        <div class="review-overlay" onClick={close}>
          <div
            class="review-content"
            ref={containerRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="review-header">
              <span class="review-file-path">{filePath()}</span>
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
