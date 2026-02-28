/**
 * Floating status bar — git branch on the left, context usage on the right.
 */

import { GitBranch } from "lucide-solid";
import { Show } from "solid-js";
import { gitBranch } from "../store";
import { ContextUsageBar } from "./ContextUsageBar";

export function StatusBar() {
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
