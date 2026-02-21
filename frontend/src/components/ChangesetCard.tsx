/**
 * Changeset Card — compact inline card rendered in the chat stream
 * when the agent proposes file changes via git_diff / git_show.
 *
 * Shows title, file tree with stats, viewed indicators, and a
 * "Review next" button that opens the full-screen review overlay.
 */

import { For, Show, createMemo } from "solid-js";
import type { ArtifactSummary } from "../store";
import { setReviewOverlayArtifactId, setReviewOverlayInitialFileId } from "../store";

interface Props {
  artifact: ArtifactSummary;
}

export function ChangesetCard(props: Props) {
  const viewedCount = createMemo(
    () => props.artifact.files.filter((f) => f.viewed).length,
  );

  const allViewed = createMemo(
    () => viewedCount() === props.artifact.files.length,
  );

  const nextUnviewed = createMemo(
    () => props.artifact.files.find((f) => !f.viewed),
  );

  // Group files by directory for display
  const groupedFiles = createMemo(() => {
    const groups = new Map<string, typeof props.artifact.files>();
    for (const file of props.artifact.files) {
      const parts = file.path.split("/");
      const dir = parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
      const existing = groups.get(dir);
      if (existing) {
        existing.push(file);
      } else {
        groups.set(dir, [file]);
      }
    }
    return groups;
  });

  function openReview(fileId?: string) {
    setReviewOverlayInitialFileId(fileId ?? null);
    setReviewOverlayArtifactId(props.artifact.artifactId);
  }

  return (
    <div class="changeset-card">
      <div class="changeset-header">
        <span class="changeset-icon">🔀</span>
        <span class="changeset-title">{props.artifact.title}</span>
      </div>

      <div class="changeset-file-tree">
        <For each={[...groupedFiles().entries()]}>
          {([dir, files]) => (
            <>
              <Show when={dir}>
                <div class="changeset-dir">{dir}</div>
              </Show>
              <For each={files}>
                {(file) => (
                  <div
                    class="changeset-file-row"
                    onClick={() => openReview(file.id)}
                  >
                    <span class="changeset-file-path">
                      {file.path.split("/").pop()}
                    </span>
                    <span class="changeset-file-stats">
                      <span class="changeset-adds">+{file.additions}</span>
                      {" "}
                      <span class="changeset-dels">−{file.deletions}</span>
                    </span>
                    <span class="changeset-viewed-indicator">
                      {file.viewed ? "●" : "○"}
                    </span>
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>

      <button class="btn changeset-review-btn" onClick={() => openReview()}>
        <Show when={!allViewed()} fallback="View summary">
          ▶ Review next{" "}
          <Show when={nextUnviewed()}>
            {(f) => <>({f().path.split("/").pop()})</>}
          </Show>
        </Show>
      </button>

      <div class="changeset-status-line">
        {viewedCount()}/{props.artifact.files.length} viewed
        <Show when={props.artifact.status !== "pending"}>
          {" — "}
          <span
            class={
              props.artifact.status === "approved"
                ? "changeset-approved"
                : "changeset-changes-requested"
            }
          >
            {props.artifact.status === "approved"
              ? "Approved"
              : "Changes requested"}
          </span>
        </Show>
      </div>
    </div>
  );
}
