/**
 * Floating status bar — git branch on the left, context usage on the right.
 */

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
              <svg
                class="status-bar-branch-icon"
                viewBox="0 0 16 16"
                fill="currentColor"
                width="14"
                height="14"
                aria-hidden="true"
              >
                <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0z" />
              </svg>
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
