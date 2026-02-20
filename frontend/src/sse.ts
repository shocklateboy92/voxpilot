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

// ── SSE event payload types (mirror backend schemas) ────────────────────────

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: string;
}

export interface MessagePayload {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  created_at: string;
  tool_calls?: ToolCallInfo[] | null;
  tool_call_id?: string | null;
  artifact_id?: string | null;
  html?: string | null;
}

export interface TextDeltaPayload {
  content: string;
}

export interface ToolCallPayload {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResultPayload {
  id: string;
  name: string;
  content: string;
  is_error: boolean;
}

export interface DonePayload {
  model: string;
  html?: string | null;
}

export interface ErrorPayload {
  message: string;
}

export interface ToolConfirmPayload {
  id: string;
  name: string;
  arguments: string;
}

export interface ReviewArtifactPayload {
  artifactId: string;
  title: string;
  status: string;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  files: Array<{
    id: string;
    path: string;
    changeType: string;
    additions: number;
    deletions: number;
    viewed?: boolean;
  }>;
}

export interface SessionStreamCallbacks {
  onMessage: (payload: MessagePayload) => void;
  onReady: () => void;
  onTextDelta: (content: string) => void;
  onToolCall: (payload: ToolCallPayload) => void;
  onToolResult: (payload: ToolResultPayload) => void;
  onToolConfirm: (payload: ToolConfirmPayload) => void;
  onReviewArtifact: (payload: ReviewArtifactPayload) => void;
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
  const url = `/api/sessions/${sessionId}/stream`;
  const es = new EventSource(url, { withCredentials: true });
  const { onError } = callbacks;

  addJsonEventListener<MessagePayload>(es, "message", onError, callbacks.onMessage);

  es.addEventListener("ready", () => {
    callbacks.onReady();
  });

  addJsonEventListener<TextDeltaPayload>(es, "text-delta", onError, (p) =>
    callbacks.onTextDelta(p.content),
  );

  addJsonEventListener<ToolCallPayload>(es, "tool-call", onError, callbacks.onToolCall);
  addJsonEventListener<ToolResultPayload>(es, "tool-result", onError, callbacks.onToolResult);
  addJsonEventListener<ToolConfirmPayload>(es, "tool-confirm", onError, callbacks.onToolConfirm);
  addJsonEventListener<ReviewArtifactPayload>(es, "review-artifact", onError, callbacks.onReviewArtifact);

  addJsonEventListener<DonePayload>(es, "done", onError, (p) =>
    callbacks.onDone(p.model, p.html ?? null),
  );

  es.addEventListener("error", (e: MessageEvent) => {
    // EventSource fires a generic error event on connection loss
    // (with no `data`).  Only dispatch to onError when we have a
    // server-sent payload; otherwise let EventSource reconnect.
    if (e.data) {
      try {
        const payload = JSON.parse(e.data) as ErrorPayload;
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
  model: string = "gpt-4.1-mini",
): Promise<Response> {
  const response = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ content, model }),
  });

  if (response.status === 401) {
    window.location.reload();
  }

  return response;
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
  const response = await fetch(`/api/sessions/${sessionId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ tool_call_id: toolCallId, approved }),
  });

  if (response.status === 401) {
    window.location.reload();
  }

  return response;
}
