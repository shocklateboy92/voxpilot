/**
 * Session picker — fullscreen overlay for mobile.
 *
 * Lists all sessions with tap-to-switch and delete.
 * Triggered by tapping the session title in BottomNav.
 */

import { For, Show } from "solid-js";
import { sessions, activeIndex, pickerOpen, setPickerOpen } from "../store";
import { switchToIndex, handleDeleteSession, handleNewSession } from "../sessions";

export function SessionPicker() {
  function selectSession(index: number): void {
    switchToIndex(index);
    setPickerOpen(false);
  }

  return (
    <Show when={pickerOpen()}>
      <div class="session-picker-overlay" onClick={() => setPickerOpen(false)}>
        <div class="session-picker" onClick={(e) => e.stopPropagation()}>
          <div class="picker-header">
            <h2>Sessions</h2>
            <button class="picker-close" onClick={() => setPickerOpen(false)}>
              ✕
            </button>
          </div>
          <div class="picker-list">
            <For each={sessions()}>
              {(session, i) => (
                <div
                  class={`picker-item${i() === activeIndex() ? " active" : ""}`}
                  onClick={() => selectSession(i())}
                >
                  <span class="picker-item-title">
                    {session.title || "New chat"}
                  </span>
                  <button
                    class="picker-item-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteSession(session.id);
                    }}
                    title="Delete"
                  >
                    🗑
                  </button>
                </div>
              )}
            </For>
          </div>
          <button
            class="btn btn-new-chat picker-new-chat"
            onClick={() => {
              void handleNewSession();
              setPickerOpen(false);
            }}
          >
            + New chat
          </button>
        </div>
      </div>
    </Show>
  );
}
