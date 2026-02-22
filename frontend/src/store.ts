/**
 * Reactive store using SolidJS signals.
 *
 * All application state lives here. Components subscribe to
 * individual signals — Solid's fine-grained reactivity ensures
 * only affected DOM nodes update.
 */

import { createSignal } from "solid-js";
import type {
  ToolCallInfo,
  SessionSummary,
  MessageRead as BackendMessageRead,
} from "@backend/schemas/api";
import type { ReviewComment, DiffFile } from "@backend/schemas/diff-document";
import type {
  ReviewArtifactEvent,
  ReviewArtifactFileEvent,
} from "@backend/schemas/events";
import type { ArtifactDetail } from "@backend/services/artifacts";

// ── Types ────────────────────────────────────────────────────────────────────
//
// Most types are imported directly from the backend schemas (Zod-inferred) and
// service interfaces, eliminating the duplication that previously existed here.
// Only frontend-specific types and extensions are defined below.

export type { ToolCallInfo, SessionSummary, ArtifactDetail };

// MessageRead extends the backend schema with frontend-only fields added
// during SSE streaming (pre-rendered HTML and linked artifact IDs).
export interface MessageRead extends BackendMessageRead {
  html?: string | null;
  artifactId?: string;
}

export interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  isError?: boolean;
  artifactId?: string;
  copilotStream?: string;
  copilotDone?: boolean;
  copilotSessionName?: string;
}

// ── Review artifact types ────────────────────────────────────────────────────
//
// Derived from the backend event and schema types.

export type ArtifactFileSummary = ReviewArtifactFileEvent;

export type ArtifactSummary = ReviewArtifactEvent;

export type ArtifactFileDetail = DiffFile;

export type ReviewCommentData = ReviewComment;

// ── Signals ──────────────────────────────────────────────────────────────────

/** All sessions, most-recently-updated first. */
export const [sessions, setSessions] = createSignal<SessionSummary[]>([]);

/** Index into sessions() for the currently active session. */
export const [activeIndex, setActiveIndex] = createSignal(0);

/** Messages for the active session (history). */
export const [messages, setMessages] = createSignal<MessageRead[]>([]);

/** Accumulated text of the in-progress assistant response (null = not streaming text). */
export const [streamingText, setStreamingText] = createSignal<string | null>(null);

/** Tool calls currently being streamed (in-flight, not yet in messages). */
export const [streamingToolCalls, setStreamingToolCalls] = createSignal<StreamingToolCall[]>([]);

/** Whether we're waiting for an assistant response. */
export const [isStreaming, setIsStreaming] = createSignal(false);

/** Error message to display (null = no error). */
export const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

/** Whether the session picker overlay is open (mobile). */
export const [pickerOpen, setPickerOpen] = createSignal(false);

/** Horizontal swipe offset in px (dampened rubber-band hint). */
export const [swipeOffset, setSwipeOffset] = createSignal(0);

/** Pending tool confirmation request (null = none pending). */
export interface PendingConfirm {
  id: string;
  name: string;
  arguments: string;
}
export const [pendingConfirm, setPendingConfirm] = createSignal<PendingConfirm | null>(null);

/** Map of artifactId → ArtifactSummary for inline changeset cards. */
export const [artifacts, setArtifacts] = createSignal<Map<string, ArtifactSummary>>(new Map());

/** Currently open review overlay target (null = closed). */
export interface ReviewOverlayTarget {
  artifactId: string;
  /** File ID to jump to when opening (undefined = default first-unviewed behaviour). */
  fileId?: string;
}
export const [reviewOverlayArtifactId, setReviewOverlayArtifactId] = createSignal<ReviewOverlayTarget | null>(null);

/** Full artifact detail for the currently open overlay. */
export const [reviewDetail, setReviewDetail] = createSignal<ArtifactDetail | null>(null);

// ── Toasts ───────────────────────────────────────────────────────────────────

/** A transient notification displayed briefly then auto-dismissed. */
export interface Toast {
  id: number;
  message: string;
}

let nextToastId = 1;

/** Active toast notifications (newest last). */
export const [toasts, setToasts] = createSignal<Toast[]>([]);

/** Show a transient error toast that auto-dismisses after a few seconds. */
export function showToast(message: string): void {
  const id = nextToastId++;
  setToasts((prev) => [...prev, { id, message }]);
  setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, 5000);
}

/** Extract a user-friendly message from an error. */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

// ── Derived ──────────────────────────────────────────────────────────────────

/** The currently active session summary, or undefined. */
export const activeSession = () => sessions()[activeIndex()];

/** ID of the active session, or undefined. */
export const activeSessionId = () => activeSession()?.id;
