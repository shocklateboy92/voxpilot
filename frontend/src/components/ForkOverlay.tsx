/**
 * Fork overlay — lets the user pick a message to fork the conversation from.
 *
 * Shows user messages as selectable fork points. Forking creates a new
 * child session that branches from the selected message.
 */

import type { TextPart } from "@opencode-ai/sdk/v2/client";
import GitFork from "lucide-solid/icons/git-fork";
import X from "lucide-solid/icons/x";
import { createMemo, createSignal, For, Show } from "solid-js";
import { produce } from "solid-js/store";
import { forkSession } from "../api-client";
import { activeSession, activeSessionId, switchToSession } from "../navigation";
import { setStore, store } from "../store";
import type { MessageWithParts } from "../types";
import { Overlay } from "./Overlay";
import { Spinner } from "./Spinner";

interface ForkOverlayProps {
  onClose: () => void;
}

export function ForkOverlay(props: ForkOverlayProps) {
  const [loading, setLoading] = createSignal(false);

  /** User messages only, in chronological order. */
  const userMessages = createMemo(() =>
    store.messages.filter((m): m is MessageWithParts => m.info.role === "user"),
  );

  /** Extract a text preview from a message's parts. */
  function preview(msg: MessageWithParts): string {
    const text = msg.parts
      .filter((p): p is TextPart => p.type === "text")
      .map((p) => p.text)
      .join("")
      .trim();
    if (text.length <= 100) return text;
    return `${text.slice(0, 100)}...`;
  }

  async function handleFork(messageID?: string): Promise<void> {
    const sessionID = activeSessionId();
    if (!sessionID) return;

    setLoading(true);
    const directory = activeSession()?.directory;
    const newSession = await forkSession(sessionID, messageID, directory);

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
    <Overlay onClose={props.onClose}>
      <div class="fork-header">
        <h2>Fork conversation</h2>
        <button
          type="button"
          class="btn btn-ghost"
          onClick={() => props.onClose()}
        >
          <X size={18} />
        </button>
      </div>

      <Show
        when={userMessages().length > 0}
        fallback={<div class="fork-empty">No messages to fork from</div>}
      >
        <div class="fork-list">
          <For each={userMessages()}>
            {(msg, index) => (
              <button
                type="button"
                class="fork-item"
                disabled={loading()}
                onClick={() => void handleFork(msg.info.id)}
              >
                <span class="fork-item-turn">Turn {index() + 1}</span>
                <span class="fork-item-preview">
                  {preview(msg) || "Empty message"}
                </span>
              </button>
            )}
          </For>
        </div>

        <button
          type="button"
          class="btn fork-action"
          disabled={loading()}
          onClick={() => void handleFork()}
        >
          <Show when={loading()} fallback={<GitFork size={16} />}>
            <Spinner />
          </Show>
          Fork entire conversation
        </button>
      </Show>
    </Overlay>
  );
}
