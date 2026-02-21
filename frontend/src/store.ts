/**
 * Reactive store using SolidJS signals.
 *
 * All application state lives here. Components subscribe to
 * individual signals — Solid's fine-grained reactivity ensures
 * only affected DOM nodes update.
 */

import { createSignal } from "solid-js";
import type { components } from "./api";

// ── Types ────────────────────────────────────────────────────────────────────

export type SessionSummary = components["schemas"]["SessionSummary"];
export type MessageRead = components["schemas"]["MessageRead"] & { html?: string | null; artifactId?: string };
export type ToolCallInfo = components["schemas"]["ToolCallInfo"];
export type GitHubUser = components["schemas"]["GitHubUser"];

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

export interface ArtifactFileSummary {
  id: string;
  path: string;
  changeType: string;
  additions: number;
  deletions: number;
  viewed: boolean;
}

export interface ArtifactSummary {
  artifactId: string;
  title: string;
  status: string;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  files: ArtifactFileSummary[];
}

export interface ArtifactFileDetail {
  id: string;
  artifactId: string;
  path: string;
  changeType: string;
  oldPath: string | null;
  additions: number;
  deletions: number;
  viewed: boolean;
  html: string;
  fullTextAvailable: boolean;
  fullTextHtml: string | null;
}

export interface ReviewCommentData {
  id: string;
  artifactId: string;
  fileId: string;
  lineId: string | null;
  lineNumber: number | null;
  content: string;
  createdAt: string;
}

export interface ArtifactDetail {
  artifact: {
    id: string;
    title: string;
    status: string;
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
    sessionId: string;
  };
  files: ArtifactFileDetail[];
  comments: ReviewCommentData[];
}

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
