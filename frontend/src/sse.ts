/**
 * SSE streaming client for session-scoped event streams.
 *
 * Uses browser-native EventSource for GET /api/sessions/{id}/stream.
 * All event payloads are JSON.
 *
 * Event types:
 *   message     → onMessage(payload)        — history replay + echoed user messages
 *   ready       → onReady()                 — end of history replay
 *   text-delta  → onTextDelta(content)      — streamed assistant token
 *   tool-call   → onToolCall(payload)       — agent tool invocation
 *   tool-result → onToolResult(payload)     — tool execution result
 *   done        → onDone(model)             — assistant response complete
 *   error       → onError(message)          — something went wrong
 */

import type { AppType } from "@backend/index";
import type {
  MessageEvent as SseMessageEvent,
  TextDeltaEvent,
  ToolCallEvent,
  ToolResultEvent,
  DoneEvent,
  ErrorEvent as SseErrorEvent,
  ToolConfirmEvent,
  ReviewArtifactEvent,
  CopilotDeltaEvent,
  CopilotDoneEvent,
  UsageEvent,
} from "@backend/schemas/events";
import { hc } from "hono/client";
import { ApiError } from "./api-client";

// Re-export backend event types so callers don't need a direct backend import.
export type {
  SseMessageEvent as MessageEvent,
  TextDeltaEvent,
  ToolCallEvent,
  ToolResultEvent,
  DoneEvent,
  SseErrorEvent as ErrorEvent,
  ToolConfirmEvent,
  ReviewArtifactEvent,
  CopilotDeltaEvent,
  CopilotDoneEvent,
  UsageEvent,
};

// ── RPC client for URL building and POST calls ──────────────────────────────

/** Throw ApiError when the server returns 401 (session expired / logged out). */
function handle401(res: Response): Response {
  if (res.status === 401) {
    throw new ApiError(401, res.statusText, "Unauthorized");
  }
  return res;
}

const rpc = hc<AppType>(window.location.origin, {
  init: { credentials: "include" },
  fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init).then(handle401),
});

export interface SessionStreamCallbacks {
  onMessage: (payload: SseMessageEvent) => void;
  onReady: () => void;
  onTextDelta: (content: string) => void;
  onToolCall: (payload: ToolCallEvent) => void;
  onToolResult: (payload: ToolResultEvent) => void;
  onToolConfirm: (payload: ToolConfirmEvent) => void;
  onReviewArtifact: (payload: ReviewArtifactEvent) => void;
  onCopilotDelta: (payload: CopilotDeltaEvent) => void;
  onCopilotDone: (payload: CopilotDoneEvent) => void;
  onUsage: (payload: UsageEvent) => void;
  onDone: (model: string, html: string | null) => void;
  onError: (message: string) => void;
}

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Register an SSE event listener that JSON-parses the payload
 * and dispatches to `handler`, routing parse failures to `onError`.
 */
function addJsonEventListener<T>(
  es: EventSource,
  eventName: string,
  onError: (message: string) => void,
  handler: (payload: T) => void,
): void {
  es.addEventListener(eventName, (e: MessageEvent) => {
    try {
      const payload = JSON.parse(e.data) as T;
      handler(payload);
    } catch {
      onError(`Failed to parse ${eventName} event: ${e.data}`);
    }
  });
}

// ── Stream connection ────────────────────────────────────────────────────────

/**
 * Connect to a session's SSE stream.
 *
 * Returns the EventSource instance so the caller can close it
 * (e.g., on session switch).  The stream replays all existing
 * messages as `message` events, then signals `ready`, then
 * delivers live events as messages are posted.
 */
export function connectSession(
  sessionId: string,
  callbacks: SessionStreamCallbacks,
): EventSource {
  const url = rpc.api.sessions[":id"].stream.$url({
    param: { id: sessionId },
  });
  const es = new EventSource(url, { withCredentials: true });
  const { onError } = callbacks;

  addJsonEventListener<SseMessageEvent>(es, "message", onError, callbacks.onMessage);

  es.addEventListener("ready", () => {
    callbacks.onReady();
  });

  addJsonEventListener<TextDeltaEvent>(es, "text-delta", onError, (p) =>
    callbacks.onTextDelta(p.content),
  );

  addJsonEventListener<ToolCallEvent>(es, "tool-call", onError, callbacks.onToolCall);
  addJsonEventListener<ToolResultEvent>(es, "tool-result", onError, callbacks.onToolResult);
  addJsonEventListener<ToolConfirmEvent>(es, "tool-confirm", onError, callbacks.onToolConfirm);
  addJsonEventListener<ReviewArtifactEvent>(es, "review-artifact", onError, callbacks.onReviewArtifact);
  addJsonEventListener<CopilotDeltaEvent>(es, "copilot-delta", onError, callbacks.onCopilotDelta);
  addJsonEventListener<CopilotDoneEvent>(es, "copilot-done", onError, callbacks.onCopilotDone);
  addJsonEventListener<UsageEvent>(es, "usage", onError, callbacks.onUsage);

  addJsonEventListener<DoneEvent>(es, "done", onError, (p) =>
    callbacks.onDone(p.model, p.html ?? null),
  );

  es.addEventListener("error", (e: MessageEvent) => {
    // EventSource fires a generic error event on connection loss
    // (with no `data`).  Only dispatch to onError when we have a
    // server-sent payload; otherwise let EventSource reconnect.
    if (e.data) {
      try {
        const payload = JSON.parse(e.data) as SseErrorEvent;
        onError(payload.message);
      } catch {
        onError(`Failed to parse error event: ${e.data}`);
      }
    }
  });

  return es;
}

/**
 * Post a user message to an active session stream.
 *
 * Returns the fetch Response (202 on success, 409 if no stream).
 */
export async function sendMessage(
  sessionId: string,
  content: string,
  model: string,
): Promise<Response> {
  return rpc.api.sessions[":id"].messages.$post({
    param: { id: sessionId },
    json: { content, model },
  });
}

/**
 * Approve or deny a tool call that requires confirmation.
 *
 * Returns the fetch Response (202 on success, 409 if no pending confirm).
 */
export async function confirmTool(
  sessionId: string,
  toolCallId: string,
  approved: boolean,
): Promise<Response> {
  return rpc.api.sessions[":id"].confirm.$post({
    param: { id: sessionId },
    json: { tool_call_id: toolCallId, approved },
  });
}
