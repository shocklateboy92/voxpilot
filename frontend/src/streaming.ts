/**
 * rAF-batched OpenCode event streaming manager.
 *
 * Bridges the OpenCode global event stream to SolidJS signals with
 * requestAnimationFrame batching on the hot path (text parts).
 */

import {
  fetchMessages,
  fetchSessions,
  respondToPermission,
  sendPromptAsync,
} from "./api-client";
import type { Event } from "./sse";
import { subscribeToEvents, unsubscribeFromEvents } from "./sse";
import {
  activeSessionId,
  type ContextUsage,
  setContextUsage,
  setErrorMessage,
  setIsStreaming,
  setMessages,
  setPendingPermission,
  setPendingQuestion,
  setSessions,
  setStreamingParts,
  setStreamingText,
} from "./store";

let pendingText = "";
let rafId: number | null = null;
let isRafLoopRunning = false;

/** Start the rAF loop that flushes pendingText → signal once per frame. */
function startRafLoop(): void {
  if (isRafLoopRunning) return;
  isRafLoopRunning = true;

  const tick = (): void => {
    if (!isRafLoopRunning) return;
    setStreamingText(pendingText);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

/** Stop the rAF loop. */
function stopRafLoop(): void {
  isRafLoopRunning = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/** Active session ID tracker for filtering events. */
let currentSessionId: string | null = null;

/** Handle a single event from the global stream. */
function handleEvent(event: Event): void {
  const sid = currentSessionId;
  if (!sid) return;

  switch (event.type) {
    case "message.updated": {
      const msg = event.properties.info;
      if (msg.sessionID !== sid) return;

      if (msg.role === "assistant") {
        // Assistant message started or completed
        if ("time" in msg && msg.time.completed) {
          // Message is complete — reload full messages
          void fetchMessages(sid).then(setMessages);
          stopRafLoop();
          pendingText = "";
          setStreamingText(null);
          setStreamingParts([]);
          setIsStreaming(false);
          setPendingPermission(null);

          // Extract token usage from the last assistant message
          if ("tokens" in msg) {
            const usage: ContextUsage = {
              inputTokens: msg.tokens.input,
              outputTokens: msg.tokens.output,
              reasoningTokens: msg.tokens.reasoning,
              cacheRead: msg.tokens.cache.read,
              cacheWrite: msg.tokens.cache.write,
            };
            setContextUsage(usage);
          }
        } else {
          setIsStreaming(true);
        }
      }
      break;
    }

    case "message.part.updated": {
      const part = event.properties.part;
      if (part.sessionID !== sid) return;

      switch (part.type) {
        case "text": {
          // Hot path: accumulate text, rAF flushes to signal
          if (!isRafLoopRunning) {
            pendingText = "";
            startRafLoop();
          }
          pendingText = part.text;
          break;
        }
        case "tool": {
          // Update streaming parts
          setStreamingParts((prev) => {
            const idx = prev.findIndex((p) => p.id === part.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = part;
              return next;
            }
            return [...prev, part];
          });
          break;
        }
        case "step-start": {
          setIsStreaming(true);
          break;
        }
        case "step-finish": {
          // Extract token usage
          const usage: ContextUsage = {
            inputTokens: part.tokens.input,
            outputTokens: part.tokens.output,
            reasoningTokens: part.tokens.reasoning,
            cacheRead: part.tokens.cache.read,
            cacheWrite: part.tokens.cache.write,
          };
          setContextUsage(usage);
          break;
        }
      }
      break;
    }

    case "permission.asked": {
      const perm = event.properties;
      if (perm.sessionID !== sid) return;
      setPendingPermission(perm);
      break;
    }

    case "permission.replied": {
      setPendingPermission(null);
      break;
    }

    case "question.asked": {
      const req = event.properties;
      if (req.sessionID !== sid) return;
      setPendingQuestion(req);
      break;
    }

    case "question.replied":
    case "question.rejected": {
      setPendingQuestion(null);
      break;
    }

    case "session.updated": {
      // Refresh session list (title may have changed)
      void fetchSessions().then(setSessions);
      break;
    }

    case "session.error": {
      const props = event.properties;
      if (props.sessionID !== sid) return;
      setIsStreaming(false);
      const err = props.error;
      let errorMsg = "An error occurred";
      if (
        err &&
        "data" in err &&
        typeof err.data === "object" &&
        err.data !== null &&
        "message" in err.data
      ) {
        errorMsg = String((err.data as Record<string, unknown>).message);
      }
      setErrorMessage(errorMsg);
      stopRafLoop();
      break;
    }
  }
}

/**
 * Connect to the OpenCode event stream and load session history.
 */
export function openStream(sessionId: string): void {
  closeStream();

  currentSessionId = sessionId;
  setMessages([]);
  setStreamingText(null);
  setStreamingParts([]);
  setIsStreaming(false);
  setErrorMessage(null);
  setPendingPermission(null);
  pendingText = "";

  // Load existing messages
  void fetchMessages(sessionId).then(setMessages);

  // Subscribe to global events
  void subscribeToEvents(handleEvent).catch((err: unknown) => {
    if (err instanceof Error && err.name === "AbortError") return;
    const msg = err instanceof Error ? err.message : "Event stream error";
    setErrorMessage(msg);
  });
}

/** Close the current event stream. */
export function closeStream(): void {
  stopRafLoop();
  currentSessionId = null;
  unsubscribeFromEvents();
}

/**
 * Send a user message on the current session.
 * Returns true on success, false on failure.
 */
export async function sendUserMessage(content: string): Promise<boolean> {
  const sessionId = activeSessionId();
  if (!sessionId) return false;

  setIsStreaming(true);
  setErrorMessage(null);

  try {
    await sendPromptAsync(sessionId, content);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    setErrorMessage(`Failed to send: ${msg}`);
    setIsStreaming(false);
    return false;
  }
}

/**
 * Respond to a pending permission request.
 */
export async function respondToConfirm(
  requestID: string,
  reply: "once" | "always" | "reject",
): Promise<void> {
  setPendingPermission(null);

  try {
    await respondToPermission(requestID, reply);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    setErrorMessage(`Permission error: ${msg}`);
  }
}
