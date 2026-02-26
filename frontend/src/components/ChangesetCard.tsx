/**
 * Changeset card — renders inline in a message when the
 * voxpilot_show_diff tool is called.
 *
 * When completed, extracts the cache ID from the tool output,
 * fetches the cached diff metadata, and renders a compact file
 * list. Clicking a file opens the ReviewOverlay.
 *
 * While pending/running, shows a spinner like the generic tool block.
 */

import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import { createResource, For, Match, Show, Switch } from "solid-js";
import { setReviewFile } from "./ReviewOverlay";

interface DiffCacheEntry {
  from: string;
  to: string;
  resolvedFrom: string;
  resolvedTo: string;
  path?: string;
  files: { file: string; additions: number; deletions: number }[];
}

interface Props {
  part: ToolPart;
}

/** Extract the [ref:UUID] cache ID from tool output text. */
function extractCacheId(output: string): string | null {
  const match = output.match(/\[ref:([a-f0-9-]+)\]/);
  return match ? (match[1] ?? null) : null;
}

export function ChangesetCard(props: Props) {
  const status = () => props.part.state.status;
  const isActive = () => status() === "pending" || status() === "running";

  const cacheId = () => {
    const s = props.part.state;
    if (s.status !== "completed") return null;
    return extractCacheId(s.output);
  };

  // Fetch cache entry when tool completes
  const [cache] = createResource(cacheId, async (id) => {
    const res = await fetch(`/api/review/ref-diff/cache/${id}`);
    if (!res.ok) return null;
    return (await res.json()) as DiffCacheEntry;
  });

  function openFile(filePath: string): void {
    const c = cache();
    if (!c) return;
    setReviewFile({
      from: c.resolvedFrom,
      to: c.resolvedTo,
      filePath,
    });
  }

  const label = () => {
    const c = cache();
    if (c) return `${c.from} \u2192 ${c.to}`;
    return "show_diff";
  };

  const errorOutput = () => {
    const s = props.part.state;
    if (s.status === "error") return s.error;
    if (s.status === "completed" && s.output.startsWith("Error:"))
      return s.output;
    return null;
  };

  return (
    <div class="changeset-card">
      <div class="changeset-header">
        <Switch>
          <Match when={isActive()}>
            <span class="tool-spinner">{"\u23F3"}</span>
          </Match>
          <Match when={status() === "completed" && !errorOutput()}>
            <span class="changeset-icon">{"\u{1F4CA}"}</span>
          </Match>
          <Match when={status() === "error" || errorOutput()}>
            <span class="changeset-icon">{"\u2717"}</span>
          </Match>
        </Switch>
        <span class="changeset-label">{label()}</span>
        <Show when={cache()}>
          {(c) => (
            <span class="changeset-stats">
              {c().files.length} file{c().files.length !== 1 ? "s" : ""}
            </span>
          )}
        </Show>
      </div>

      {/* Error state */}
      <Show when={errorOutput()}>
        {(err) => (
          <div class="changeset-error">
            <pre>{err()}</pre>
          </div>
        )}
      </Show>

      {/* File list */}
      <Show when={cache()}>
        {(c) => (
          <Show when={!errorOutput()}>
            <For each={c().files}>
              {(f) => (
                <button
                  type="button"
                  class="changeset-file-row"
                  onClick={() => openFile(f.file)}
                >
                  <span class="changeset-file-path">{f.file}</span>
                  <span class="changeset-file-stats">
                    <span class="changeset-adds">+{f.additions}</span>{" "}
                    <span class="changeset-dels">-{f.deletions}</span>
                  </span>
                </button>
              )}
            </For>
          </Show>
        )}
      </Show>

      {/* Loading cache */}
      <Show when={status() === "completed" && !errorOutput() && cache.loading}>
        <div class="changeset-loading">Loading files...</div>
      </Show>
    </div>
  );
}
