/**
 * Floating status bar — git branch on the left, context usage on the right.
 */

import { GitBranch } from "lucide-solid";
import { onMount, Show } from "solid-js";
import { fetchGitBranch } from "../api-client";
import { gitBranch, setGitBranch } from "../store";
import { ContextUsageBar } from "./ContextUsageBar";

export function StatusBar() {
  onMount(async () => {
    const branch = await fetchGitBranch();
    setGitBranch(branch);
  });

  return (
    <div class="status-bar">
      <div class="status-bar-left">
        <Show
          when={gitBranch()}
          fallback={<span class="status-bar-branch-placeholder" />}
        >
          {(branch) => (
            <span class="status-bar-branch" title={branch()}>
              <GitBranch size={14} />
              {branch()}
            </span>
          )}
        </Show>
      </div>
      <div class="status-bar-right">
        <ContextUsageBar />
      </div>
    </div>
  );
}
