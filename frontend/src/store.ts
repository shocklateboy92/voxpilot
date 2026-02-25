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

/**
 * Reactive version counter — bumped whenever the active session changes.
 * Used to make activeSessionId() reactive despite reading from the URL hash.
 */
const [hashVersion, setHashVersion] = createSignal(0);

/** Bump the hash version to notify reactive consumers. */
export function notifySessionChanged(): void {
  setHashVersion((v) => v + 1);
}

/** ID of the currently active session, read from the URL hash. */
export const activeSessionId = (): string | undefined => {
  hashVersion(); // subscribe to changes
  const hash = window.location.hash.slice(1);
  return hash || undefined;
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
