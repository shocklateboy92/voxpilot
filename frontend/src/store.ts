/**
 * Reactive store using SolidJS signals.
 *
 * All application state lives here. Components subscribe to
 * individual signals — Solid's fine-grained reactivity ensures
 * only affected DOM nodes update.
 */

import { createSignal } from "solid-js";
import type {
  GitHubUser,
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

export type { GitHubUser, ToolCallInfo, SessionSummary, ArtifactDetail };

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

export type ArtifactFileSummary = Omit<ReviewArtifactFileEvent, "viewed"> & {
  viewed: boolean;
};

export type ArtifactSummary = Omit<ReviewArtifactEvent, "files"> & {
  files: ArtifactFileSummary[];
};

export type ArtifactFileDetail = DiffFile;

export type ReviewCommentData = ReviewComment;

// ── Signals ──────────────────────────────────────────────────────────────────

/** Authenticated user (null = not logged in / unknown). */
export const [user, setUser] = createSignal<GitHubUser | null>(null);

/** Auth check complete — prevents flash of login view. */
export const [authChecked, setAuthChecked] = createSignal(false);

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

// ── Derived ──────────────────────────────────────────────────────────────────

/** The currently active session summary, or undefined. */
export const activeSession = () => sessions()[activeIndex()];

/** ID of the active session, or undefined. */
export const activeSessionId = () => activeSession()?.id;
