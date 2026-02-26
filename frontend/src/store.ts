/**
 * Reactive store using SolidJS signals and stores.
 */

import type {
  AssistantMessage,
  PermissionRequest,
  QuestionRequest,
  Part as SdkPart,
  StepFinishPart,
} from "@opencode-ai/sdk/v2/client";
import { createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
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

/**
 * Extract context usage from loaded messages.
 * Looks at the last assistant message's tokens, or the last step-finish part.
 */
export function extractContextUsageFromMessages(
  msgs: MessageWithParts[],
): ContextUsage | null {
  // Walk backwards to find the last assistant message
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]!;
    if (msg.info.role !== "assistant") continue;

    // First try step-finish parts (most granular, per-step)
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j]!;
      if (part.type === "step-finish") {
        const sf = part as StepFinishPart;
        return {
          inputTokens: sf.tokens.input,
          outputTokens: sf.tokens.output,
          reasoningTokens: sf.tokens.reasoning,
          cacheRead: sf.tokens.cache.read,
          cacheWrite: sf.tokens.cache.write,
        };
      }
    }

    // Fall back to message-level tokens
    const info = msg.info as AssistantMessage;
    if (info.tokens) {
      return {
        inputTokens: info.tokens.input,
        outputTokens: info.tokens.output,
        reasoningTokens: info.tokens.reasoning,
        cacheRead: info.tokens.cache.read,
        cacheWrite: info.tokens.cache.write,
      };
    }
  }

  return null;
}

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

/** Token usage from the latest step-finish event. */
export const [contextUsage, setContextUsage] =
  createSignal<ContextUsage | null>(null);

/** Current git branch name. */
export const [gitBranch, setGitBranch] = createSignal<string | null>(null);

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
