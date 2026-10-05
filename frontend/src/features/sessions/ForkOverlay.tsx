/**
 * Fork overlay — lets the user pick a message to fork the conversation from.
 *
 * Shows user messages as selectable fork points. Forking creates a new
 * child session that branches from the selected message.
 */

import type { SessionMessageUser } from "@opencode/client";
import GitFork from "lucide-solid/icons/git-fork";
import { createMemo, createSignal, For, Show } from "solid-js";
import { produce } from "solid-js/store";
import { activeSessionId, switchToSession } from "../../app/navigation";
import { setStore, store } from "../../app/store";
import { forkSession } from "../../platform/api-client";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ListRow } from "../../ui/ListRow";
import { Overlay } from "../../ui/Overlay";
import { OverlayHeader } from "../../ui/OverlayHeader";
import { Spinner } from "../../ui/Spinner";

interface ForkOverlayProps {
  onClose: () => void;
}

export function ForkOverlay(props: ForkOverlayProps) {
  const [loading, setLoading] = createSignal(false);

  /** User messages only, in chronological order. */
  const userMessages = createMemo(() =>
    store.messages.filter((m) => m.type === "user"),
  );

  /** Extract a text preview from a user message. */
  function preview(msg: SessionMessageUser): string {
    const text = msg.text.trim();
    if (text.length <= 100) return text;
    return `${text.slice(0, 100)}...`;
  }

  async function handleFork(messageID?: string): Promise<void> {
    const sessionID = activeSessionId();
    if (!sessionID) return;

    setLoading(true);
    const newSession = await forkSession(sessionID, messageID);

    // Optimistically insert the forked session into the store
    setStore(
      "sessions",
      produce((list) => {
        if (list.some((s) => s.id === newSession.id)) return;
        list.push(newSession);
        list.sort((a, b) => b.time.updated - a.time.updated);
      }),
    );

    switchToSession(newSession.id);
    props.onClose();
  }

  return (
    <Overlay label="Fork conversation" onClose={props.onClose}>
      <OverlayHeader title="Fork conversation" onClose={props.onClose} />

      <Show
        when={userMessages().length > 0}
        fallback={<EmptyState>No messages to fork from</EmptyState>}
      >
        <div class="min-h-0 flex-1 overflow-y-auto py-2">
          <For each={userMessages()}>
            {(msg, index) => (
              <ListRow
                type="button"
                disabled={loading()}
                onClick={() => void handleFork(msg.id)}
              >
                <span class="min-w-14 shrink-0 text-xs font-semibold text-accent">
                  Turn {index() + 1}
                </span>
                <span class="min-w-0 flex-1 truncate text-[0.85rem] text-muted">
                  {preview(msg) || "Empty message"}
                </span>
              </ListRow>
            )}
          </For>
        </div>

        <Button
          type="button"
          class="mx-4 mt-2 mb-3"
          disabled={loading()}
          onClick={() => void handleFork()}
        >
          <Show when={loading()} fallback={<GitFork size={16} />}>
            <Spinner />
          </Show>
          Fork entire conversation
        </Button>
      </Show>
    </Overlay>
  );
}
