/**
 * rAF-batched SSE streaming manager.
 *
 * Bridges the SSE event stream to SolidJS signals with
 * requestAnimationFrame batching on the hot path (text-delta).
 * This ensures at most one DOM update per frame regardless
 * of how fast tokens arrive.
 */

import { connectSession, sendMessage as ssePostMessage, confirmTool } from "./sse";
import type { ToolCallPayload, ToolResultPayload, ToolConfirmPayload, ReviewArtifactPayload, CopilotDeltaPayload, CopilotDonePayload } from "./sse";
import {
  setMessages,
  setStreamingText,
  setStreamingToolCalls,
  setIsStreaming,
  setErrorMessage,
  activeSessionId,
  setSessions,
  setPendingConfirm,
  setArtifacts,
  type MessageRead,
  type StreamingToolCall,
  type ArtifactSummary,
} from "./store";
import { fetchSessions } from "./api-client";

let activeStream: EventSource | null = null;
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

/** Flush any remaining pending text to the signal immediately. */
function flushPendingText(): void {
  if (pendingText) {
    setStreamingText(pendingText);
  }
}

/**
 * Connect to a session's SSE stream.
 *
 * Handles history replay (populates messages signal) and
 * live streaming (populates streamingText / streamingToolCalls).
 */
export function openStream(sessionId: string): void {
  closeStream();

  setMessages([]);
  setStreamingText(null);
  setStreamingToolCalls([]);
  setErrorMessage(null);
  setPendingConfirm(null);
  setArtifacts(new Map());
  pendingText = "";

  activeStream = connectSession(sessionId, {
    onMessage(payload) {
      const msg: MessageRead = {
        role: payload.role,
        content: payload.content,
        created_at: payload.created_at,
        tool_calls: payload.tool_calls ?? null,
        tool_call_id: payload.tool_call_id ?? null,
        html: payload.html ?? null,
      };
      if (payload.artifact_id) {
        msg.artifactId = payload.artifact_id;
      }
      setMessages((prev) => [...prev, msg]);
    },

    onReady() {
      setIsStreaming(false);
    },

    onTextDelta(content) {
      // Hot path: accumulate into buffer, rAF loop writes to signal
      if (!isRafLoopRunning) {
        pendingText = "";
        startRafLoop();
      }
      pendingText += content;
    },

    onToolCall(payload: ToolCallPayload) {
      // Finalize any in-progress streaming text
      stopRafLoop();
      if (pendingText) {
        flushPendingText();
        // Move streamed text into messages array as a complete message
        const text = pendingText;
        pendingText = "";
        setStreamingText(null);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: text, created_at: new Date().toISOString() },
        ]);
      }

      const tc: StreamingToolCall = {
        id: payload.id,
        name: payload.name,
        arguments: payload.arguments,
      };
      setStreamingToolCalls((prev) => [...prev, tc]);
    },

    onToolResult(payload: ToolResultPayload) {
      setPendingConfirm(null);
      const rawArtifactId = (payload as ToolResultPayload & { artifact_id?: string }).artifact_id;
      setStreamingToolCalls((prev) =>
        prev.map((tc): StreamingToolCall => {
          if (tc.id !== payload.id) return tc;
          const updated: StreamingToolCall = {
            ...tc,
            result: payload.content,
            isError: payload.is_error,
          };
          if (rawArtifactId) {
            updated.artifactId = rawArtifactId;
          }
          return updated;
        }),
      );
    },

    onToolConfirm(payload: ToolConfirmPayload) {
      setPendingConfirm({
        id: payload.id,
        name: payload.name,
        arguments: payload.arguments,
      });
    },

    onReviewArtifact(payload: ReviewArtifactPayload) {
      const summary: ArtifactSummary = {
        artifactId: payload.artifactId,
        title: payload.title,
        status: payload.status,
        totalFiles: payload.totalFiles,
        totalAdditions: payload.totalAdditions,
        totalDeletions: payload.totalDeletions,
        files: payload.files.map((f) => ({
          ...f,
          viewed: f.viewed ?? false,
        })),
      };
      setArtifacts((prev) => {
        const next = new Map(prev);
        next.set(payload.artifactId, summary);
        return next;
      });
    },

    onCopilotDelta(payload: CopilotDeltaPayload) {
      setStreamingToolCalls((prev) =>
        prev.map((tc): StreamingToolCall => {
          if (tc.id !== payload.tool_call_id) return tc;
          return {
            ...tc,
            copilotStream: (tc.copilotStream ?? "") + payload.content,
            copilotSessionName: payload.session_name || tc.copilotSessionName,
          };
        }),
      );
    },

    onCopilotDone(payload: CopilotDonePayload) {
      setStreamingToolCalls((prev) =>
        prev.map((tc): StreamingToolCall => {
          if (tc.id !== payload.tool_call_id) return tc;
          return {
            ...tc,
            copilotDone: true,
            copilotSessionName: payload.session_name || tc.copilotSessionName,
          };
        }),
      );
    },

    onDone(_model, html) {
      stopRafLoop();
      setPendingConfirm(null);

      // Finalize any remaining streamed text
      if (pendingText) {
        flushPendingText();
        const text = pendingText;
        pendingText = "";
        setStreamingText(null);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: text, created_at: new Date().toISOString(), html },
        ]);
      } else {
        setStreamingText(null);
      }

      // Move completed tool calls into messages
      const toolCalls = [...getStreamingToolCallsSnapshot()];
      if (toolCalls.length > 0) {
        // Add the assistant message with tool_calls
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant" as const,
            content: "",
            created_at: new Date().toISOString(),
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            })),
          },
        ]);
        // Add tool result messages
        for (const tc of toolCalls) {
          if (tc.result !== undefined) {
            const toolMsg: MessageRead = {
              role: "tool" as const,
              content: tc.result ?? "",
              created_at: new Date().toISOString(),
              tool_call_id: tc.id,
            };
            if (tc.artifactId) {
              toolMsg.artifactId = tc.artifactId;
            }
            setMessages((prev) => [...prev, toolMsg]);
          }
        }
        setStreamingToolCalls([]);
      }

      setIsStreaming(false);

      // Refresh session list (title may have been auto-set)
      void fetchSessions().then(setSessions);
    },

    onError(message) {
      stopRafLoop();
      setPendingConfirm(null);

      if (pendingText) {
        // Flush what we have and show error after
        flushPendingText();
        const text = pendingText;
        pendingText = "";
        setStreamingText(null);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: text, created_at: new Date().toISOString() },
        ]);
      } else {
        setStreamingText(null);
      }

      setStreamingToolCalls([]);
      setIsStreaming(false);
      setErrorMessage(message);
    },
  });
}

/** Close the current SSE stream. */
export function closeStream(): void {
  stopRafLoop();
  if (activeStream) {
    activeStream.close();
    activeStream = null;
  }
}

/**
 * Send a user message on the current session's stream.
 *
 * Returns true on success, false on failure.
 */
export async function sendUserMessage(content: string): Promise<boolean> {
  const sessionId = activeSessionId();
  if (!sessionId) return false;

  setIsStreaming(true);
  setErrorMessage(null);

  try {
    const response = await ssePostMessage(sessionId, content);
    if (!response.ok && response.status !== 202) {
      const text = await response.text();
      setErrorMessage(`Failed to send: HTTP ${response.status} — ${text}`);
      setIsStreaming(false);
      return false;
    }
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    setErrorMessage(`Network error: ${msg}`);
    setIsStreaming(false);
    return false;
  }
}

/**
 * Approve or deny a pending tool confirmation.
 */
export async function respondToConfirm(
  toolCallId: string,
  approved: boolean,
): Promise<void> {
  const sessionId = activeSessionId();
  if (!sessionId) return;

  setPendingConfirm(null);

  try {
    await confirmTool(sessionId, toolCallId, approved);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    setErrorMessage(`Confirm error: ${msg}`);
  }
}

// Helper to read current tool calls snapshot (avoids importing the getter)
import { streamingToolCalls as getStreamingToolCallsSignal } from "./store";
function getStreamingToolCallsSnapshot(): StreamingToolCall[] {
  return getStreamingToolCallsSignal();
}
