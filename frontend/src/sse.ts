/**
 * SSE streaming client for the /api/chat endpoint.
 *
 * Parses Server-Sent Events with typed event dispatching:
 *   text-delta  → onTextDelta(content)
 *   done        → onDone(model)
 *   error       → onError(message)
 */

// ── SSE event payload types (mirror backend schemas) ────────────────────────

export interface TextDeltaPayload {
  content: string;
}

export interface DonePayload {
  model: string;
}

export interface ErrorPayload {
  message: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamChatCallbacks {
  onTextDelta: (content: string) => void;
  onDone: (model: string) => void;
  onError: (message: string) => void;
}

/**
 * Stream a chat completion via SSE.
 *
 * Returns a promise that resolves when the stream ends (done or error).
 * Throws only on network-level failures (fetch itself failing).
 */
export async function streamChat(
  messages: ChatMessage[],
  model: string,
  callbacks: StreamChatCallbacks,
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ messages, model }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Auth expired — reload to trigger login flow
      window.location.reload();
      return;
    }
    const text = await response.text();
    callbacks.onError(`HTTP ${response.status}: ${text}`);
    return;
  }

  const body = response.body;
  if (!body) {
    callbacks.onError("Response body is empty");
    return;
  }

  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += value;
    // Normalize \r\n → \n (sse-starlette uses \r\n per SSE spec)
    buffer = buffer.replaceAll("\r\n", "\n");
    // SSE events are separated by double newlines
    const parts = buffer.split("\n\n");
    // Last part may be incomplete — keep it in the buffer
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      if (part.trim() === "") continue;
      dispatchSSEEvent(part, callbacks);
    }
  }

  // Process any remaining data in the buffer
  if (buffer.trim() !== "") {
    dispatchSSEEvent(buffer, callbacks);
  }
}

/**
 * Parse a single SSE event block and dispatch to the appropriate callback.
 *
 * An event block looks like:
 *   event: text-delta
 *   data: {"content": "Hello"}
 */
function dispatchSSEEvent(raw: string, callbacks: StreamChatCallbacks): void {
  let eventType = "";
  let data = "";

  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data = line.slice("data:".length).trim();
    }
    // Ignore id:, retry:, comments (lines starting with :)
  }

  if (!eventType || !data) return;

  try {
    switch (eventType) {
      case "text-delta": {
        const payload = JSON.parse(data) as TextDeltaPayload;
        callbacks.onTextDelta(payload.content);
        break;
      }
      case "done": {
        const payload = JSON.parse(data) as DonePayload;
        callbacks.onDone(payload.model);
        break;
      }
      case "error": {
        const payload = JSON.parse(data) as ErrorPayload;
        callbacks.onError(payload.message);
        break;
      }
      // Silently ignore unknown event types (forward-compatible)
    }
  } catch {
    callbacks.onError(`Failed to parse SSE event: ${data}`);
  }
}
