/**
 * Reactive store using SolidJS signals.
 */

import type {
  PermissionRequest,
  QuestionRequest,
} from "@opencode-ai/sdk/v2/client";
import { createSignal } from "solid-js";
import type { Message, MessageWithParts, Part, Session } from "./api-client";

export type { Session, Message, Part, MessageWithParts };

// ── Streaming state types ──────────────────────────────────────

export type PendingPermission = PermissionRequest;

export type ContextUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheRead: number;
  cacheWrite: number;
};

// ── Toast types ──────────────────────────────────────────────────

export interface Toast {
  id: number;
  message: string;
}

let nextToastId = 0;

// ── Signals ──────────────────────────────────────────────────────

/** All sessions, most-recently-updated first. */
export const [sessions, setSessions] = createSignal<Session[]>([]);

/** ID of the currently active session (stored in URL hash). */
export const [activeSessionId, setActiveSessionId] = createSignal<
  string | undefined
>(undefined);

/** Derived index into sessions() for the currently active session. */
export const activeIndex = () => {
  const id = activeSessionId();
  if (!id) return 0;
  const idx = sessions().findIndex((s) => s.id === id);
  return idx >= 0 ? idx : 0;
};

/** Messages for the active session (history). */
export const [messages, setMessages] = createSignal<MessageWithParts[]>([]);

/** Live parts being streamed for the current assistant message. */
export const [streamingParts, setStreamingParts] = createSignal<Part[]>([]);

/** Accumulated text of the in-progress assistant response (null = not streaming text). */
export const [streamingText, setStreamingText] = createSignal<string | null>(
  null,
);

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

/** Token usage from the latest step-finish event. */
export const [contextUsage, setContextUsage] =
  createSignal<ContextUsage | null>(null);

/** Toast notifications. */
export const [toasts, setToasts] = createSignal<Toast[]>([]);

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
export const activeSession = () => sessions()[activeIndex()];

/** Top-level (root) sessions only — sessions without a parent in the list. */
export const rootSessions = () => {
  const list = sessions();
  const ids = new Set(list.map((s) => s.id));
  return list.filter((s) => !s.parentID || !ids.has(s.parentID));
};

/** Index of the active session within rootSessions(), or -1 if it's a child. */
export const activeRootIndex = () => {
  const id = activeSessionId();
  if (!id) return 0;
  const idx = rootSessions().findIndex((s) => s.id === id);
  return idx >= 0 ? idx : -1;
};
