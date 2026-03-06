/**
 * Consolidated reactive store — single createStore<AppState>.
 *
 * All server-sourced state lives in one store. UI-only state (toast,
 * agent preference, picker visibility, swipe offset) lives in their
 * own modules or component-local signals.
 *
 * The store is populated via top-level await of init() before any
 * consumer module executes (the app is lazy-loaded via index.tsx).
 *
 * Derived accessors that depend on activeSessionId live in navigation.ts
 * to avoid a circular dependency.
 */

import type {
  AssistantMessage,
  Part as SdkPart,
} from "@opencode-ai/sdk/v2/client";
import { createStore } from "solid-js/store";
import { produce, reconcile } from "solid-js/store";
import type { Part, MessageWithParts } from "./api-client";
import { init } from "./init";
import type { AppState } from "./types";

// Re-export types from types.ts for consumers
export type { AppState, Session, Message, Part, MessageWithParts, Project, PendingPermission } from "./types";

// ── Store creation (top-level await) ────────────────────────────
// init() fetches all bootstrap data; createStore wraps it reactively.
// By the time any importing module executes, the store is fully populated.

const data = await init();
export const [store, setStore] = createStore<AppState>(data);

// ── Mutation helpers ────────────────────────────────────────────

/** Replace the entire messages array (used for history load and reconciliation). */
export function replaceMessages(msgs: MessageWithParts[]): void {
  setStore("messages", reconcile(msgs));
}

/**
 * Ensure an in-progress assistant message exists in the store for the given messageID.
 * If it doesn't exist, creates a placeholder entry so parts can be appended to it.
 */
export function ensureAssistantMessage(
  messageID: string,
  sessionID: string,
  info?: AssistantMessage,
): void {
  const idx = store.messages.findIndex((m) => m.info.id === messageID);
  if (idx >= 0) {
    // Already exists — update its info if provided
    if (info) {
      setStore("messages", idx, "info", info);
    }
    return;
  }

  // Create a placeholder assistant message
  const placeholder: MessageWithParts = {
    info:
      info ??
      ({
        id: messageID,
        sessionID,
        role: "assistant",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        cost: 0,
        time: { created: Date.now() },
      } as AssistantMessage),
    parts: [],
  };

  setStore(
    "messages",
    produce((msgs) => {
      msgs.push(placeholder);
    }),
  );
}

/**
 * Upsert a part into the message it belongs to.
 * If the part already exists (by ID), it is replaced; otherwise it is appended.
 */
export function upsertPart(part: SdkPart): void {
  const msgIdx = store.messages.findIndex((m) => m.info.id === part.messageID);
  if (msgIdx < 0) return;

  const msg = store.messages[msgIdx];
  if (!msg) return;
  const partIdx = msg.parts.findIndex((p) => p.id === part.id);
  if (partIdx >= 0) {
    // Replace existing part
    setStore("messages", msgIdx, "parts", partIdx, reconcile(part));
  } else {
    // Append new part
    setStore(
      "messages",
      msgIdx,
      "parts",
      produce((parts: Part[]) => {
        parts.push(part as Part);
      }),
    );
  }
}
