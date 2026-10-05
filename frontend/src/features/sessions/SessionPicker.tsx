/**
 * Session picker — fullscreen overlay for mobile.
 *
 * Lists all sessions with tap-to-switch and delete.
 * Sub-sessions are grouped under their parent and visually indented.
 * Triggered by tapping the session title in BottomNav.
 */

import Trash2 from "lucide-solid/icons/trash-2";
import { createMemo, For, Show } from "solid-js";
import {
  activeSessionId,
  handleDeleteSession,
  handleNewSession,
  switchToSession,
} from "../../app/navigation";
import { store } from "../../app/store";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { ListRow } from "../../ui/ListRow";
import { Overlay } from "../../ui/Overlay";
import { OverlayHeader } from "../../ui/OverlayHeader";

type GroupedEntry = {
  originalIndex: number;
  isChild: boolean;
};

interface SessionPickerProps {
  onClose: () => void;
}

export function SessionPicker(props: SessionPickerProps) {
  function selectSession(sessionId: string): void {
    switchToSession(sessionId);
    props.onClose();
  }

  /** Map projectID → display name (project name or directory basename). */
  const projectNameMap = createMemo(() => {
    const map = new Map<string, string>();
    for (const p of store.projects) {
      const name = p.name ?? p.canonical.split("/").pop() ?? p.canonical;
      map.set(p.id, name);
    }
    return map;
  });

  const showProjectBadge = createMemo(() => store.projects.length > 1);

  /** Sessions reordered so children appear directly after their parent. */
  const grouped = createMemo(() => {
    const list = store.sessions;
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
    <Overlay label="Sessions" onClose={props.onClose} class="session-picker">
      <OverlayHeader
        class="picker-header"
        title="Sessions"
        onClose={props.onClose}
      />
      <div class="min-h-0 flex-1 overflow-y-auto py-2">
        <For each={grouped()}>
          {(entry) => {
            const session = () => store.sessions[entry.originalIndex];
            return (
              <div
                class="picker-item flex min-h-12 items-center gap-2 pr-4 transition-colors hover:bg-bg"
                classList={{
                  active: session()?.id === activeSessionId(),
                  child: entry.isChild,
                  "border-l-[3px] border-accent bg-bg":
                    session()?.id === activeSessionId(),
                }}
              >
                <ListRow
                  type="button"
                  class="min-w-0 flex-1"
                  onClick={() => {
                    const id = session()?.id;
                    if (id) selectSession(id);
                  }}
                >
                  <span
                    class="min-w-0 flex-1 truncate text-[0.9rem]"
                    classList={{ "pl-6": entry.isChild }}
                  >
                    {session()?.title || "New chat"}
                  </span>
                  <Show when={showProjectBadge()}>
                    <Badge class="max-w-32 truncate">
                      {projectNameMap().get(session()?.projectID ?? "") ?? ""}
                    </Badge>
                  </Show>
                </ListRow>
                <IconButton
                  type="button"
                  variant="ghost"
                  class="opacity-40 hover:opacity-100"
                  aria-label="Delete session"
                  onClick={() => {
                    const id = session()?.id;
                    if (id) void handleDeleteSession(id);
                  }}
                  title="Delete"
                >
                  <Trash2 size={16} />
                </IconButton>
              </div>
            );
          }}
        </For>
      </div>
      <Button
        type="button"
        variant="primary"
        class="mx-4 mt-2 mb-3"
        onClick={() => {
          handleNewSession();
          props.onClose();
        }}
      >
        + New chat
      </Button>
    </Overlay>
  );
}
