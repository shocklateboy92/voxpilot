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

import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import GitCompareArrows from "lucide-solid/icons/git-compare-arrows";
import Loader from "lucide-solid/icons/loader";
import X from "lucide-solid/icons/x";
import { createResource, Match, Show, Switch } from "solid-js";
import { rpc } from "../rpc";
import { ChangesetSummary } from "./ChangesetSummary";
import { getOutput } from "./tool-renderers/shared";

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
  const isActive = () => status() === "streaming" || status() === "running";

  const cacheId = () => {
    const s = props.part.state;
    if (s.status !== "completed") return null;
    return extractCacheId(getOutput(s) ?? "");
  };

  // Fetch cache entry when tool completes
  const [cache] = createResource(
    cacheId,
    async (id) => {
      return rpc.snapshot({ id });
    },
    { initialValue: null },
  );

  const errorOutput = () => {
    const s = props.part.state;
    const output = getOutput(s);
    if (s.status === "error") return output;
    if (s.status === "completed" && output?.startsWith("Error:")) return output;
    return null;
  };

  return (
    <Show
      when={cache()}
      fallback={
        <div class="changeset-card">
          <div class="changeset-header">
            <Switch>
              <Match when={isActive()}>
                <span class="tool-spinner">
                  <Loader size={14} class="icon-spin" />
                </span>
              </Match>
              <Match when={status() === "completed" && !errorOutput()}>
                <span class="changeset-icon">
                  <GitCompareArrows size={14} />
                </span>
              </Match>
              <Match when={status() === "error" || errorOutput()}>
                <span class="changeset-icon">
                  <X size={14} />
                </span>
              </Match>
            </Switch>
            <span class="changeset-label">show_diff</span>
          </div>

          {/* Error state */}
          <Show when={errorOutput()}>
            {(err) => (
              <div class="changeset-error">
                <pre>{err()}</pre>
              </div>
            )}
          </Show>

          {/* Loading cache */}
          <Show
            when={status() === "completed" && !errorOutput() && cache.loading}
          >
            <div class="changeset-loading">Loading files...</div>
          </Show>
        </div>
      }
    >
      {(snapshot) => <ChangesetSummary snapshot={snapshot()} />}
    </Show>
  );
}
