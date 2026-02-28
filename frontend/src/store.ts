/**
 * Reactive store using SolidJS signals and stores.
 */

import type {
  AssistantMessage,
  PermissionRequest,
  QuestionRequest,
  Part as SdkPart,
} from "@opencode-ai/sdk/v2/client";
import { createEffect, createResource, createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import type { Message, MessageWithParts, Part, Session } from "./api-client";
import { fetchAgents, fetchGitBranch, fetchSessions } from "./api-client";

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

/** Whether we're waiting for an assistant response. */
export const [isStreaming, setIsStreaming] = createSignal(false);

/** Error message to display (null = no error). */
export const [errorMessage, setErrorMessage] = createSignal<string | null>(
  null,
);

/** Whether the session picker overlay is open (mobile). */
export const [pickerOpen, setPickerOpen] = createSignal(false);

/** Horizontal swipe offset in px (dampened rubber-band hint). */
export const [swipeOffset, setSwipeOffset] = createSignal(0);

/** Pending permission request (null = none pending). */
export const [pendingPermission, setPendingPermission] =
  createSignal<PendingPermission | null>(null);

/** Pending question request (null = none pending). */
export const [pendingQuestion, setPendingQuestion] =
  createSignal<QuestionRequest | null>(null);

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

// ── Derived ──────────────────────────────────────────────────────

/** The currently active session summary, or undefined. */
export const activeSession = () => {
  const id = activeSessionId();
  return sessions().find((s) => s.id === id);
};

/** Top-level (root) sessions only — sessions without a parentID. */
export const rootSessions = () => {
  return sessions().filter((s) => !s.parentID);
};

/** Index of the active session within rootSessions(), or -1 if it's a child. */
export const activeRootIndex = () => {
  const id = activeSessionId();
  if (!id) return 0;
  const idx = rootSessions().findIndex((s) => s.id === id);
  return idx >= 0 ? idx : -1;
};
