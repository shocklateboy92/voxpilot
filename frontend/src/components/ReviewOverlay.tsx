/**
 * Full-screen review overlay — horizontal carousel of per-file diffs.
 *
 * Opens when the user taps a file or "Review next" in the ChangesetCard.
 * Uses `attachSwipeHandler` from gestures.ts for file navigation.
 * Server-rendered HTML is injected via innerHTML for the diff view.
 */

import {
  Show,
  For,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
} from "solid-js";
import {
  reviewOverlayArtifactId,
  setReviewOverlayArtifactId,
  reviewDetail,
  setReviewDetail,
  setArtifacts,
  type ArtifactDetail,
  type ReviewCommentData,
} from "../store";
import {
  fetchArtifact,
  patchFileViewed,
  postFileComment,
  submitReview,
} from "../api-client";
import { attachSwipeHandler } from "../gestures";

type ViewMode = "diff" | "full";

export function ReviewOverlay() {
  const [currentFileIndex, setCurrentFileIndex] = createSignal(0);
  const [commentText, setCommentText] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<ViewMode>("full");

  // Total pages = files + 1 (summary page)
  const totalPages = () => {
    const detail = reviewDetail();
    return detail ? detail.files.length + 1 : 0;
  };

  const isOnSummaryPage = () => currentFileIndex() >= (reviewDetail()?.files.length ?? 0);
  const currentFile = () => {
    const detail = reviewDetail();
    if (!detail) return undefined;
    return detail.files[currentFileIndex()];
  };

  // Load artifact detail when overlay opens
  createEffect(() => {
    const target = reviewOverlayArtifactId();
    if (!target) {
      setReviewDetail(null);
      setCurrentFileIndex(0);
      return;
    }

    void fetchArtifact(target.artifactId).then((detail) => {
      if (detail) {
        setReviewDetail(detail);
        if (target.fileId) {
          const idx = detail.files.findIndex((f) => f.id === target.fileId);
          setCurrentFileIndex(idx >= 0 ? idx : 0);
        } else {
          // Start at first unviewed file, or 0
          const idx = detail.files.findIndex((f) => !f.viewed);
          setCurrentFileIndex(idx >= 0 ? idx : 0);
        }
      }
    });
  });

  function close() {
    setReviewOverlayArtifactId(null);
  }

  // Reset view mode when navigating between files
  createEffect(() => {
    // Access the signal so we react to changes
    currentFileIndex();
    setViewMode("full");
  });

  function toggleViewMode() {
    setViewMode((prev) => prev === "diff" ? "full" : "diff");
  }

  function navigateToFile(index: number) {
    const pages = totalPages();
    if (index >= 0 && index < pages) {
      // Auto-mark previous file as viewed when swiping forward
      const prevIdx = currentFileIndex();
      const detail = reviewDetail();
      if (detail && index > prevIdx && prevIdx < detail.files.length) {
        const prevFile = detail.files[prevIdx];
        if (prevFile && !prevFile.viewed) {
          void markViewed(prevIdx, true);
        }
      }
      setCurrentFileIndex(index);
    }
  }

  async function markViewed(fileIndex: number, viewed: boolean) {
    const detail = reviewDetail();
    if (!detail) return;
    const file = detail.files[fileIndex];
    if (!file) return;

    await patchFileViewed(detail.artifact.id, file.id, viewed);

    // Update local state
    setReviewDetail((prev) => {
      if (!prev) return prev;
      const files = prev.files.map((f, i) =>
        i === fileIndex ? { ...f, viewed } : f,
      );
      return { ...prev, files };
    });

    // Update artifact summary in the card
    setArtifacts((prev) => {
      const next = new Map(prev);
      const summary = next.get(detail.artifact.id);
      if (summary) {
        const files = summary.files.map((f) =>
          f.id === file.id ? { ...f, viewed } : f,
        );
        next.set(detail.artifact.id, { ...summary, files });
      }
      return next;
    });
  }

  async function addFileComment() {
    const text = commentText().trim();
    if (!text) return;
    const detail = reviewDetail();
    const file = currentFile();
    if (!detail || !file) return;

    const comment = await postFileComment(detail.artifact.id, file.id, text);
    if (comment) {
      setReviewDetail((prev) => {
        if (!prev) return prev;
        return { ...prev, comments: [...prev.comments, comment] };
      });
      setCommentText("");
    }
  }

  async function handleSubmit() {
    const detail = reviewDetail();
    if (!detail) return;
    setSubmitting(true);

    const result = await submitReview(detail.artifact.id);
    if (result) {
      // Update artifact summary status
      setArtifacts((prev) => {
        const next = new Map(prev);
        const summary = next.get(detail.artifact.id);
        if (summary) {
          next.set(detail.artifact.id, { ...summary, status: result.status });
        }
        return next;
      });
    }
    setSubmitting(false);
    close();
  }

  const fileCommentsForCurrent = () => {
    const detail = reviewDetail();
    const file = currentFile();
    if (!detail || !file) return [];
    return detail.comments.filter((c) => c.fileId === file.id);
  };

  const allViewed = () => {
    const detail = reviewDetail();
    if (!detail) return false;
    return detail.files.every((f) => f.viewed);
  };

  return (
    <Show when={reviewOverlayArtifactId()}>
      <div class="review-overlay">
        <Show when={reviewDetail()} fallback={<div class="review-loading">Loading…</div>}>
          {(detail) => (
            <ReviewContent
              detail={detail()}
              currentFileIndex={currentFileIndex()}
              isOnSummaryPage={isOnSummaryPage()}
              currentFile={currentFile()}
              totalPages={totalPages()}
              commentText={commentText()}
              submitting={submitting()}
              allViewed={allViewed()}
              fileComments={fileCommentsForCurrent()}
              viewMode={viewMode()}
              onNavigate={navigateToFile}
              onClose={close}
              onMarkViewed={markViewed}
              onSetCommentText={setCommentText}
              onAddComment={() => void addFileComment()}
              onSubmit={() => void handleSubmit()}
              onToggleViewMode={toggleViewMode}
            />
          )}
        </Show>
      </div>
    </Show>
  );
}

interface ReviewContentProps {
  detail: ArtifactDetail;
  currentFileIndex: number;
  isOnSummaryPage: boolean;
  currentFile: ArtifactDetail["files"][0] | undefined;
  totalPages: number;
  commentText: string;
  submitting: boolean;
  allViewed: boolean;
  fileComments: ReviewCommentData[];
  viewMode: ViewMode;
  onNavigate: (index: number) => void;
  onClose: () => void;
  onMarkViewed: (fileIndex: number, viewed: boolean) => void;
  onSetCommentText: (text: string) => void;
  onAddComment: () => void;
  onSubmit: () => void;
  onToggleViewMode: () => void;
}

function ReviewContent(props: ReviewContentProps) {
  let containerRef: HTMLDivElement | undefined;

  // Attach swipe handler
  onMount(() => {
    if (!containerRef) return;
    const cleanup = attachSwipeHandler(containerRef, {
      onSwipeMove() {
        // Could add visual feedback here
      },
      onSwipeLeft() {
        props.onNavigate(props.currentFileIndex + 1);
      },
      onSwipeRight() {
        props.onNavigate(props.currentFileIndex - 1);
      },
      onSwipeCancel() {},
    });
    onCleanup(cleanup);
  });

  return (
    <div class="review-content" ref={containerRef}>
      {/* Header bar */}
      <div class="review-header">
        <button class="review-close-btn" onClick={props.onClose}>
          ✕
        </button>
        <div class="review-page-indicator">
          <Show when={!props.isOnSummaryPage && props.currentFile} fallback="Review Summary">
            {props.currentFile?.path}
          </Show>
          <span class="review-page-count">
            {" "}
            {props.currentFileIndex + 1}/{props.totalPages}
          </span>
        </div>
        <Show when={!props.isOnSummaryPage && props.currentFile?.fullTextHtml}>
          <button
            class={`review-view-toggle ${props.viewMode === "full" ? "active" : ""}`}
            onClick={props.onToggleViewMode}
            title={props.viewMode === "diff" ? "Show full file" : "Show diff only"}
          >
            {props.viewMode === "diff" ? "📄" : "±"}
          </button>
        </Show>
      </div>

      {/* File diff page or summary */}
      <Show
        when={!props.isOnSummaryPage}
        fallback={
          <ReviewSummaryPage
            detail={props.detail}
            allViewed={props.allViewed}
            submitting={props.submitting}
            onNavigate={props.onNavigate}
            onSubmit={props.onSubmit}
            onClose={props.onClose}
          />
        }
      >
        <div class="review-diff-container">
          <Show when={props.currentFile}>
            {(file) => (
              <Show
                when={props.viewMode === "full" && file().fullTextHtml}
                fallback={<div class="review-diff-scroll" innerHTML={file().html} />}
              >
                <div class="review-fulltext-scroll" innerHTML={file().fullTextHtml ?? ""} />
              </Show>
            )}
          </Show>
        </div>

        {/* Bottom bar */}
        <div class="review-bottom-bar">
          <div class="review-bottom-row">
            <span class="review-comment-count">
              💬 {props.fileComments.length} comment{props.fileComments.length !== 1 ? "s" : ""}
            </span>
            <label class="review-viewed-check">
              <input
                type="checkbox"
                checked={props.currentFile?.viewed ?? false}
                onChange={(e) =>
                  props.onMarkViewed(
                    props.currentFileIndex,
                    e.currentTarget.checked,
                  )
                }
              />
              Viewed
            </label>
          </div>

          {/* Comments list */}
          <Show when={props.fileComments.length > 0}>
            <div class="review-comments-list">
              <For each={props.fileComments}>
                {(c) => (
                  <div class="review-comment-item">
                    <Show when={c.lineNumber}>
                      <span class="review-comment-line">L{c.lineNumber}</span>
                    </Show>
                    <span class="review-comment-text">{c.content}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Comment input */}
          <div class="review-comment-input-row">
            <input
              class="review-comment-input"
              type="text"
              placeholder="Add comment to this file…"
              value={props.commentText}
              onInput={(e) => props.onSetCommentText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") props.onAddComment();
              }}
            />
            <button
              class="btn btn-small"
              disabled={!props.commentText.trim()}
              onClick={props.onAddComment}
            >
              Add
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

interface ReviewSummaryProps {
  detail: ArtifactDetail;
  allViewed: boolean;
  submitting: boolean;
  onNavigate: (index: number) => void;
  onSubmit: () => void;
  onClose: () => void;
}

function ReviewSummaryPage(props: ReviewSummaryProps) {
  return (
    <div class="review-summary-page">
      <h2>Review Summary</h2>

      <div class="review-summary-files">
        <For each={props.detail.files}>
          {(file, index) => (
            <div
              class="review-summary-file"
              onClick={() => {
                props.onNavigate(index());
              }}
            >
              <span class="review-summary-icon">
                {file.viewed ? "✅" : "⚠️"}
              </span>
              <span class="review-summary-path">{file.path}</span>
              <span class="review-summary-status">
                ({file.viewed ? "viewed" : "not viewed"})
              </span>
            </div>
          )}
        </For>

        {/* Show comment digest */}
        <Show when={props.detail.comments.length > 0}>
          <div class="review-summary-comments">
            <For each={props.detail.comments}>
              {(c) => {
                const file = () =>
                  props.detail.files.find((f) => f.id === c.fileId);
                return (
                  <div class="review-summary-comment">
                    <span class="review-summary-comment-file">
                      {file()?.path ?? "unknown"}
                    </span>
                    <Show when={c.lineNumber}>
                      <span class="review-summary-comment-line">
                        L{c.lineNumber}
                      </span>
                    </Show>
                    : {c.content}
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>

      <div class="review-summary-actions">
        <button
          class="btn"
          disabled={!props.allViewed || props.submitting}
          onClick={props.onSubmit}
        >
          {props.submitting ? "Submitting…" : "Submit Review"}
        </button>
        <button class="btn btn-secondary" onClick={props.onClose}>
          Back to chat
        </button>
      </div>
    </div>
  );
}
