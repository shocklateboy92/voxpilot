/**
 * Changeset card — shows file diffs summary for a session.
 */

import type { FileDiff } from "@opencode-ai/sdk/client";
import { createResource, createSignal, For, Show } from "solid-js";
import { fetchSessionDiff } from "../api-client";
import { getFileState } from "../review-state";
import { activeSessionId } from "../store";
import { setReviewFile } from "./ReviewOverlay";

export function ChangesetCard() {
  const [expanded, setExpanded] = createSignal(false);

  const [diffs] = createResource(
    () => (expanded() ? activeSessionId() : undefined),
    async (sessionId) => {
      if (!sessionId) return [];
      return fetchSessionDiff(sessionId);
    },
  );

  const sessionId = () => activeSessionId() ?? "";

  const totalStats = () => {
    const d = diffs();
    if (!d) return { additions: 0, deletions: 0, files: 0 };
    return {
      additions: d.reduce((sum, f) => sum + f.additions, 0),
      deletions: d.reduce((sum, f) => sum + f.deletions, 0),
      files: d.length,
    };
  };

  return (
    <div class="changeset-card">
      <button class="changeset-toggle" onClick={() => setExpanded(!expanded())}>
        <span class="changeset-icon">{"\u{1F4DD}"}</span>
        <Show when={diffs()}>
          <span class="changeset-stats">
            {totalStats().files} files
            <span class="stat-add">+{totalStats().additions}</span>
            <span class="stat-del">-{totalStats().deletions}</span>
          </span>
        </Show>
        <Show when={!diffs() && expanded()}>
          <span>Loading...</span>
        </Show>
        <span class="changeset-chevron">
          {expanded() ? "\u25BC" : "\u25B6"}
        </span>
      </button>
      <Show when={expanded() && diffs()}>
        <div class="changeset-files">
          <For each={diffs()}>
            {(diff: FileDiff) => {
              const reviewed = () =>
                getFileState(sessionId(), diff.file).viewed;
              return (
                <div
                  class={`changeset-file ${reviewed() ? "viewed" : ""}`}
                  onClick={() => setReviewFile(diff)}
                >
                  <span class="file-path">{diff.file}</span>
                  <span class="file-stats">
                    <span class="stat-add">+{diff.additions}</span>
                    <span class="stat-del">-{diff.deletions}</span>
                  </span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
