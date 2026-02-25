/**
 * Session picker — fullscreen overlay for mobile.
 *
 * Lists all sessions with tap-to-switch and delete.
 * Sub-sessions are grouped under their parent and visually indented.
 * Triggered by tapping the session title in BottomNav.
 */

import { createMemo, For, Show } from "solid-js";
import {
  handleDeleteSession,
  handleNewSession,
  switchToIndex,
} from "../sessions";
import { activeIndex, pickerOpen, sessions, setPickerOpen } from "../store";

type GroupedEntry = {
  originalIndex: number;
  isChild: boolean;
};

export function SessionPicker() {
  function selectSession(index: number): void {
    switchToIndex(index);
    setPickerOpen(false);
  }

  /** Sessions reordered so children appear directly after their parent. */
  const grouped = createMemo(() => {
    const list = sessions();
    const parentIds = new Set(list.map((s) => s.id));
    const childrenByParent = new Map<string, GroupedEntry[]>();

    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s?.parentID && parentIds.has(s.parentID)) {
        const arr = childrenByParent.get(s.parentID) ?? [];
        arr.push({ originalIndex: i, isChild: true });
        childrenByParent.set(s.parentID, arr);
      }
    }

    const result: GroupedEntry[] = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s?.parentID || !parentIds.has(s.parentID)) {
        result.push({ originalIndex: i, isChild: false });
        const children = childrenByParent.get(s?.id ?? "");
        if (children) {
          result.push(...children);
        }
      }
    }
    return result;
  });

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
            <For each={grouped()}>
              {(entry) => {
                const session = () => sessions()[entry.originalIndex];
                return (
                  <div
                    class={`picker-item${entry.originalIndex === activeIndex() ? " active" : ""}${entry.isChild ? " child" : ""}`}
                    onClick={() => selectSession(entry.originalIndex)}
                  >
                    <span class="picker-item-title">
                      {session()?.title || "New chat"}
                    </span>
                    <button
                      class="picker-item-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        const id = session()?.id;
                        if (id) void handleDeleteSession(id);
                      }}
                      title="Delete"
                    >
                      🗑
                    </button>
                  </div>
                );
              }}
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
