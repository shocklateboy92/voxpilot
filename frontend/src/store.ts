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
export type MessageRead = components["schemas"]["MessageRead"];
export type ToolCallInfo = components["schemas"]["ToolCallInfo"];
export type GitHubUser = components["schemas"]["GitHubUser"];

export interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  isError?: boolean;
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

/** Horizontal swipe offset in px (for slide transition). */
export const [swipeOffset, setSwipeOffset] = createSignal(0);

/** Whether a swipe transition is animating. */
export const [swipeAnimating, setSwipeAnimating] = createSignal(false);

// ── Derived ──────────────────────────────────────────────────────────────────

/** The currently active session summary, or undefined. */
export const activeSession = () => sessions()[activeIndex()];

/** ID of the active session, or undefined. */
export const activeSessionId = () => activeSession()?.id;
