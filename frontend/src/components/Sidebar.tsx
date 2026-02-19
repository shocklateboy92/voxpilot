/**
 * Desktop sidebar — session list + new chat button.
 * Hidden on mobile via CSS media query.
 */

import { For } from "solid-js";
import { sessions, activeIndex } from "../store";
import { switchToIndex, handleNewSession, handleDeleteSession } from "../sessions";

export function Sidebar() {
  return (
    <aside id="sidebar">
      <button class="btn btn-new-chat" onClick={() => void handleNewSession()}>
        + New chat
      </button>
      <div id="session-list">
        <For each={sessions()}>
          {(session, i) => (
            <div
              class={`session-item${i() === activeIndex() ? " active" : ""}`}
              data-id={session.id}
            >
              <span
                class="session-title"
                onClick={() => switchToIndex(i())}
              >
                {session.title || "New chat"}
              </span>
              <button
                class="session-delete"
                title="Delete session"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDeleteSession(session.id);
                }}
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>
    </aside>
  );
}
