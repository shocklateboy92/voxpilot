/**
 * Session picker — fullscreen overlay for mobile.
 *
 * Lists all sessions with tap-to-switch and delete.
 * Sub-sessions are grouped under their parent and visually indented.
 * Triggered by tapping the session title in BottomNav.
 */

import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { createMemo, For, Show } from "solid-js";
import {
  handleDeleteSession,
  handleNewSession,
  switchToSession,
} from "../sessions";
import { activeSessionId, pickerOpen, projects, sessions, setPickerOpen } from "../store";

type GroupedEntry = {
  originalIndex: number;
  isChild: boolean;
};

export function SessionPicker() {
  function selectSession(sessionId: string): void {
    switchToSession(sessionId);
    setPickerOpen(false);
  }

  /** Map projectID → display name (project name or directory basename). */
  const projectNameMap = createMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects()) {
      const name = p.name ?? p.worktree.split("/").pop() ?? p.worktree;
      map.set(p.id, name);
    }
    return map;
  });

  const showProjectBadge = createMemo(() => projects().length > 1);

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
            <button class="btn btn-ghost" onClick={() => setPickerOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <div class="picker-list">
            <For each={grouped()}>
              {(entry) => {
                const session = () => sessions()[entry.originalIndex];
                return (
                  <div
                    class="picker-item"
                    classList={{
                      active: session()?.id === activeSessionId(),
                      child: entry.isChild,
                    }}
                    onClick={() => {
                      const id = session()?.id;
                      if (id) selectSession(id);
                    }}
                  >
                    <span class="picker-item-title">
                      {session()?.title || "New chat"}
                    </span>
                    <Show when={showProjectBadge()}>
                      <span class="picker-item-project">
                        {projectNameMap().get(session()?.projectID ?? "") ?? ""}
                      </span>
                    </Show>
                    <button
                      class="btn btn-ghost picker-item-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        const id = session()?.id;
                        if (id) void handleDeleteSession(id);
                      }}
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              }}
            </For>
          </div>
          <button
            class="btn picker-new-chat"
            onClick={() => {
              handleNewSession();
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
