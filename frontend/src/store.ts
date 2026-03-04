/**
 * Consolidated reactive store — single createStore<AppState>.
 *
 * All server-sourced state lives in one store. UI-only state (toast,
 * agent preference, picker visibility, swipe offset) lives in their
 * own modules or component-local signals.
 *
 * The store is populated via top-level await of init() before any
 * consumer module executes (the app is lazy-loaded via index.tsx).
 */

import type {
  AssistantMessage,
  Part as SdkPart,
} from "@opencode-ai/sdk/v2/client";
import { createStore } from "solid-js/store";
import { produce, reconcile } from "solid-js/store";
import type { Part } from "./api-client";
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
export function replaceMessages(msgs: import("./types").MessageWithParts[]): void {
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
  const placeholder: import("./types").MessageWithParts = {
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

// ── Scroll position persistence ──────────────────────────────────

interface SavedScrollState {
  scrollTop: number;
  atBottom: boolean;
}

const scrollPositions = new Map<string, SavedScrollState>();

/**
 * Callback that returns the current scrollTop of the messages container.
 * Registered by ChatMain on mount — keeps the store decoupled from the DOM.
 */
let scrollTopGetter: (() => { scrollTop: number; atBottom: boolean }) | undefined;

/** ChatMain calls this on mount to provide a loose read-only hook into scroll state. */
export function registerScrollTopGetter(
  getter: () => { scrollTop: number; atBottom: boolean },
): void {
  scrollTopGetter = getter;
}

/** Save the current scroll position for a session (called before switching). */
export function saveCurrentScrollPosition(sessionId: string | undefined): void {
  if (!sessionId || !scrollTopGetter) return;
  scrollPositions.set(sessionId, scrollTopGetter());
}

/** Consume (read + delete) a saved scroll state for a session. Returns undefined if none saved. */
export function consumeScrollPosition(
  sessionId: string,
): SavedScrollState | undefined {
  const state = scrollPositions.get(sessionId);
  if (state !== undefined) scrollPositions.delete(sessionId);
  return state;
}

/** Remove saved scroll state for a deleted session. */
export function clearScrollPosition(sessionId: string): void {
  scrollPositions.delete(sessionId);
}

// ── Derived accessors ───────────────────────────────────────────
// These import activeSessionId from navigation.ts. The circular
// dependency (navigation.ts also imports from store.ts) is safe
// because these are plain functions — they only read at call time,
// not at module evaluation time.

import { activeSessionId } from "./navigation";

/** The currently active session summary, or undefined. */
export const activeSession = () => {
  const id = activeSessionId();
  return store.sessions.find((s) => s.id === id);
};

/** Top-level (root) sessions only — sessions without a parentID. */
export const rootSessions = () => {
  return store.sessions.filter((s) => !s.parentID);
};

/** Whether we're on the "new session" page (no active session selected). */
export const isNewSessionPage = () => activeSessionId() === undefined;

/**
 * Index of the active session within rootSessions(), or -1 if on the new session page.
 * Layout: [new session page (-1)] [0: most recent] [1] ... [N-1: oldest]
 */
export const activeRootIndex = () => {
  const id = activeSessionId();
  if (!id) return -1;
  const idx = rootSessions().findIndex((s) => s.id === id);
  return idx >= 0 ? idx : -1;
};

/** Whether we're waiting for an assistant response (derived from messages store). */
export const isStreaming = () => {
  if (store.sessionError) return false;

  const len = store.messages.length;
  if (len === 0) return false;
  const last = store.messages[len - 1];
  if (!last) return false;

  // If the last message is a user message (optimistic), we're waiting for the assistant
  if (last.info.role === "user") {
    return true;
  }

  // Last message is an assistant message — still streaming until time.completed is set
  return !last.info.time.completed;
};

/** Pending permission for the active session (derived from cross-session store). */
export const pendingPermission = () => {
  const id = activeSessionId();
  if (!id) return null;
  return store.sessionPermissions[id] ?? null;
};

/** Pending question for the active session (derived from cross-session store). */
export const pendingQuestion = () => {
  const id = activeSessionId();
  if (!id) return null;
  return store.sessionQuestions[id] ?? null;
};

/** Whether a session needs attention (permission, question, error, or waiting). */
export function sessionNeedsAttention(id: string): boolean {
  return (
    id in store.sessionPermissions ||
    id in store.sessionQuestions ||
    id in store.sessionErrors
  );
}
