/**
 * Reactive store using SolidJS signals and stores.
 */

import type {
  AssistantMessage,
  PermissionRequest,
  Part as SdkPart,
} from "@opencode-ai/sdk/v2/client";
import { createEffect, createMemo, createResource, createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import type { Message, MessageWithParts, Part, Session } from "./api-client";
import {
  fetchAgents,
  fetchGitBranch,
  fetchPendingPermissions,
  fetchPendingQuestions,
  fetchSessions,
} from "./api-client";

export type { Session, Message, Part, MessageWithParts };

// ── Streaming state types ──────────────────────────────────────

export type PendingPermission = PermissionRequest;

// ── Toast types ──────────────────────────────────────────────────

export interface Toast {
  id: number;
  message: string;
}

let nextToastId = 0;

// ── Signals ──────────────────────────────────────────────────────

/** All sessions, most-recently-updated first. */
export const [sessions, { mutate: mutateSessions, refetch: refetchSessions }] =
  createResource(fetchSessions, { initialValue: [] });

/** ID of the currently active session. */
export const [activeSessionId, setActiveSessionId] = createSignal<string | undefined>(
  window.location.hash.slice(1) || undefined
);

// Sync signal → URL hash
createEffect(() => {
  const id = activeSessionId();
  if (id) {
    history.replaceState(null, "", `#${id}`);
  } else {
    history.replaceState(null, "", window.location.pathname);
  }
});

// Sync URL hash → signal (browser back/forward, manual edits)
window.addEventListener("hashchange", () => {
  const hash = window.location.hash.slice(1);
  setActiveSessionId(hash || undefined);
});

/** Messages for the active session — single source of truth for both history and streaming. */
export const [messages, setMessages] = createStore<MessageWithParts[]>([]);

/** Replace the entire messages array (used for history load and reconciliation). */
export function replaceMessages(msgs: MessageWithParts[]): void {
  setMessages(reconcile(msgs));
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
  const idx = messages.findIndex((m) => m.info.id === messageID);
  if (idx >= 0) {
    // Already exists — update its info if provided
    if (info) {
      setMessages(idx, "info", info);
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

  setMessages(
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
  const msgIdx = messages.findIndex((m) => m.info.id === part.messageID);
  if (msgIdx < 0) return;

  const partIdx = messages[msgIdx]!.parts.findIndex((p) => p.id === part.id);
  if (partIdx >= 0) {
    // Replace existing part
    setMessages(msgIdx, "parts", partIdx, reconcile(part));
  } else {
    // Append new part
    setMessages(
      msgIdx,
      "parts",
      produce((parts) => {
        parts.push(part as Part);
      }),
    );
  }
}

/** Session error flag — set on session.error SSE, cleared on new messages or session switch. */
export const [sessionError, setSessionError] = createSignal(false);

/** Whether we're waiting for an assistant response (derived from messages store). */
export const isStreaming = createMemo(() => {
  if (sessionError()) return false;

  const len = messages.length;
  if (len === 0) return false;
  const last = messages[len - 1];
  if (!last) return false;

  // If the last message is a user message (optimistic), we're waiting for the assistant
  if (last.info.role === "user") {
    return true;
  }

  // Last message is an assistant message — still streaming until time.completed is set
  return !last.info.time.completed;
});

/** Error message to display (null = no error). */
export const [errorMessage, setErrorMessage] = createSignal<string | null>(
  null,
);

/** Whether the session picker overlay is open (mobile). */
export const [pickerOpen, setPickerOpen] = createSignal(false);

/** Horizontal swipe offset in px (dampened rubber-band hint). */
export const [swipeOffset, setSwipeOffset] = createSignal(0);

/** Pending permission request (null = none pending). */
export const [pendingPermission, { mutate: mutatePermission }] =
  createResource(activeSessionId, async (sid) => {
    const all = await fetchPendingPermissions();
    return all.find((p) => p.sessionID === sid) ?? null;
  }, { initialValue: null });

/** Pending question request (null = none pending). */
export const [pendingQuestion, { mutate: mutateQuestion }] =
  createResource(activeSessionId, async (sid) => {
    const all = await fetchPendingQuestions();
    return all.find((q) => q.sessionID === sid) ?? null;
  }, { initialValue: null });

/** Current git branch name. */
export const [gitBranch] = createResource(fetchGitBranch);

/** Toast notifications. */
export const [toasts, setToasts] = createSignal<Toast[]>([]);

// ── Agent/mode state ─────────────────────────────────────────────

/** Available agents fetched from OpenCode (primary agents only). */
export const [agents] = createResource(async () => {
  const all = await fetchAgents();
  return all.filter(a => (a.mode === "primary" || a.mode === "all") && !a.hidden);
}, { initialValue: [] });

const AGENT_STORAGE_KEY = "voxpilot-selected-agent";

/** Currently selected agent name (persisted to localStorage). */
export const [selectedAgent, setSelectedAgent] = createSignal<string>(
  localStorage.getItem(AGENT_STORAGE_KEY) ?? "build",
);

createEffect(() => {
  localStorage.setItem(AGENT_STORAGE_KEY, selectedAgent());
});

// ── Toast helpers ────────────────────────────────────────────────

const TOAST_DURATION_MS = 5000;

export function showToast(message: string): void {
  const id = nextToastId++;
  setToasts((prev) => [...prev, { id, message }]);
  setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, TOAST_DURATION_MS);
}

export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "An unexpected error occurred";
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

/** Save the current scroll position for the active session (called before switching). */
export function saveCurrentScrollPosition(): void {
  const id = activeSessionId();
  if (!id || !scrollTopGetter) return;
  scrollPositions.set(id, scrollTopGetter());
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

// ── Derived ──────────────────────────────────────────────────────

/** The currently active session summary, or undefined. */
export const activeSession = () => {
  const id = activeSessionId();
  return sessions().find((s) => s.id === id);
};

// ── Session validation ──────────────────────────────────────────

/**
 * Reactive session validation: if sessions have loaded and activeSessionId
 * points to a session that doesn't exist, redirect to the new session page.
 * Handles deep-link-to-deleted-session and initial load with no sessions.
 */
createEffect(() => {
  if (sessions.loading) return; // Don't make decisions while loading
  const id = activeSessionId();
  if (id === undefined) return; // Already on new session page — nothing to validate
  const list = sessions();
  if (!list.some((s) => s.id === id)) {
    // Active session not found in the list — redirect to new session page
    setActiveSessionId(undefined);
  }
});

/** Top-level (root) sessions only — sessions without a parentID. */
export const rootSessions = () => {
  return sessions().filter((s) => !s.parentID);
};

/** Whether we're on the "new session" page (no active session selected). */
export const isNewSessionPage = () => activeSessionId() === undefined;

/** Index of the active session within rootSessions(), or roots.length if on the new session page. */
export const activeRootIndex = () => {
  const id = activeSessionId();
  if (!id) return rootSessions().length; // past the end = new session page
  const idx = rootSessions().findIndex((s) => s.id === id);
  return idx >= 0 ? idx : -1;
};
