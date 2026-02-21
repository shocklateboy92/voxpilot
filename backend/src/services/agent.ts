/**
 * Agentic loop — call LLM, execute tools, feed results back, repeat.
 *
 * The `runAgentLoop` async generator yields SSE-ready event objects that
 * the chat route streams to the frontend.  It handles:
 *
 * - Streaming text deltas from every LLM call
 * - Detecting tool-call finish reasons and executing tools
 * - Persisting assistant + tool messages to the DB
 * - Capping iterations to prevent runaway loops
 */

import OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat/completions";
import type { getDb } from "../db";
import type { ChatMessage, ToolCallInfo } from "../schemas/api";
import type {
  TextDeltaEvent,
  ToolCallEvent,
  ToolResultEvent,
  ToolConfirmEvent,
  CopilotDeltaEvent,
  CopilotDoneEvent,
  DoneEvent,
  ErrorEvent,
} from "../schemas/events";
import { renderMarkdown } from "./markdown";
import { addMessage } from "./sessions";
import type { Tool, ToolResult } from "../tools";
import { defaultRegistry } from "../tools";
import { createReviewArtifact } from "./artifact-pipeline";
import { getConnection } from "./copilot-acp";
import { AsyncChannel } from "./streams";

type Db = ReturnType<typeof getDb>;

const GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com";

// ── SSE event types ─────────────────────────────────────────────────────────

export interface SseEvent {
  event: string;
  data: string;
}

// ── Convert ChatMessage → OpenAI SDK message param ──────────────────────────

function toMessageParam(m: ChatMessage): ChatCompletionMessageParam {
  if (m.role === "system") {
    return { role: "system", content: m.content } satisfies ChatCompletionSystemMessageParam;
  }

  if (m.role === "tool") {
    return {
      role: "tool",
      content: m.content,
      tool_call_id: m.tool_call_id ?? "",
    } satisfies ChatCompletionToolMessageParam;
  }

  if (m.role === "assistant") {
    if (m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      } satisfies ChatCompletionAssistantMessageParam;
    }
    return { role: "assistant", content: m.content } satisfies ChatCompletionAssistantMessageParam;
  }

  return { role: "user", content: m.content } satisfies ChatCompletionUserMessageParam;
}

// ── Accumulated tool call from streaming ────────────────────────────────────

class StreamedToolCall {
  id = "";
  name = "";
  arguments = "";
}

// ── Agent loop options ──────────────────────────────────────────────────────

export interface AgentLoopOptions {
  messages: ChatMessage[];
  model: string;
  ghToken: string;
  workDir: string;
  db: Db;
  sessionId: string;
  maxIterations?: number;
  isDisconnected?: () => boolean;
  requestConfirmation?: (
    toolCallId: string,
    toolName: string,
    toolArgs: string,
  ) => Promise<boolean>;
}

// ── Agent loop ──────────────────────────────────────────────────────────────

export async function* runAgentLoop(
  opts: AgentLoopOptions,
): AsyncGenerator<SseEvent> {
  const {
    messages,
    model,
    ghToken,
    workDir,
    db,
    sessionId,
    maxIterations = 25,
    isDisconnected,
    requestConfirmation,
  } = opts;

  const openaiMessages: ChatCompletionMessageParam[] = messages.map(toMessageParam);
  const toolsSpec = defaultRegistry.toOpenAiTools();

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const client = new OpenAI({
      baseURL: GITHUB_MODELS_BASE_URL,
      apiKey: ghToken,
    });

    let modelName = model;
    let accumulatedText = "";
    const toolCalls: StreamedToolCall[] = [];
    let finishReason: string | null = null;

    try {
      const llmStream = await client.chat.completions.create({
        model,
        messages: openaiMessages,
        tools: toolsSpec,
        stream: true,
      });

      for await (const chunk of llmStream as AsyncIterable<ChatCompletionChunk>) {
        if (isDisconnected?.()) return;

        const choice = chunk.choices[0];
        if (!choice) {
          if (chunk.model) modelName = chunk.model;
          continue;
        }

        const delta = choice.delta;

        // Accumulate text content
        if (delta.content) {
          accumulatedText += delta.content;
          const payload: TextDeltaEvent = { content: delta.content };
          yield { event: "text-delta", data: JSON.stringify(payload) };
        }

        // Accumulate tool calls (streamed incrementally)
        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index;
            while (toolCalls.length <= idx) {
              toolCalls.push(new StreamedToolCall());
            }
            const tc = toolCalls[idx];
            if (tc) {
              if (tcDelta.id) tc.id = tcDelta.id;
              if (tcDelta.function) {
                if (tcDelta.function.name) tc.name = tcDelta.function.name;
                if (tcDelta.function.arguments) {
                  tc.arguments += tcDelta.function.arguments;
                }
              }
            }
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;
        if (chunk.model) modelName = chunk.model;
      }
    } catch (exc) {
      if (accumulatedText) {
        await addMessage(db, sessionId, "assistant", accumulatedText);
      }
      const errorMsg = exc instanceof Error ? exc.message : String(exc);
      const payload: ErrorEvent = { message: errorMsg };
      yield { event: "error", data: JSON.stringify(payload) };
      return;
    }

    // ── Handle finish reason ──────────────────────────────────────
    if (finishReason === "tool_calls" && toolCalls.length > 0) {
      // Persist the assistant message with tool calls
      const toolCallInfos: ToolCallInfo[] = toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      }));

      await addMessage(db, sessionId, "assistant", accumulatedText, {
        toolCalls: JSON.stringify(toolCallInfos),
      });

      // Add assistant message to conversation for the next LLM call
      openaiMessages.push({
        role: "assistant",
        content: accumulatedText || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      } satisfies ChatCompletionAssistantMessageParam);

      // Execute each tool
      for (const tc of toolCalls) {
        const toolCallPayload: ToolCallEvent = {
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        };
        yield { event: "tool-call", data: JSON.stringify(toolCallPayload) };

        const tool = defaultRegistry.get(tc.name);
        if (tool == null) {
          const resultText = `Error: unknown tool '${tc.name}'.`;
          const resultPayload: ToolResultEvent = {
            id: tc.id,
            name: tc.name,
            content: resultText,
            is_error: true,
          };
          yield { event: "tool-result", data: JSON.stringify(resultPayload) };
          await addMessage(db, sessionId, "tool", resultText, {
            toolCallId: tc.id,
          });
          openaiMessages.push({
            role: "tool",
            content: resultText,
            tool_call_id: tc.id,
          } satisfies ChatCompletionToolMessageParam);
          continue;
        }

        // Check if tool requires confirmation
        if (tool.requiresConfirmation) {
          const confirmPayload: ToolConfirmEvent = {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          };
          yield { event: "tool-confirm", data: JSON.stringify(confirmPayload) };

          let approved = false;
          if (requestConfirmation) {
            approved = await requestConfirmation(tc.id, tc.name, tc.arguments);
          }

          if (!approved) {
            const resultText = "Error: user declined to run this tool.";
            const resultPayload: ToolResultEvent = {
              id: tc.id,
              name: tc.name,
              content: resultText,
              is_error: true,
            };
            yield { event: "tool-result", data: JSON.stringify(resultPayload) };
            await addMessage(db, sessionId, "tool", resultText, {
              toolCallId: tc.id,
            });
            openaiMessages.push({
              role: "tool",
              content: resultText,
              tool_call_id: tc.id,
            } satisfies ChatCompletionToolMessageParam);
            continue;
          }
        }

        // ── Special-case: copilot_agent ────────────────────────────────
        if (tc.name === "copilot_agent") {
          let copilotResult: ToolResult;
          try {
            const args: Record<string, unknown> = tc.arguments
              ? (JSON.parse(tc.arguments) as Record<string, unknown>)
              : {};
            const promptText = typeof args.prompt === "string" ? args.prompt : "";
            const sessionName = typeof args.session_name === "string" ? args.session_name : "default";

            const copilotConn = await getConnection(sessionId, workDir);
            await copilotConn.getOrCreateSession(sessionName, workDir);
            copilotConn.outputBuffer.set(tc.id, "");

            const deltaChannel = new AsyncChannel<string | null>();
            const promptPromise = copilotConn.prompt(sessionName, promptText, (content) => {
              const prev = copilotConn.outputBuffer.get(tc.id) ?? "";
              copilotConn.outputBuffer.set(tc.id, prev + content);
              deltaChannel.send(content);
            });

            // Signal end-of-stream when prompt resolves
            promptPromise.then(
              () => deltaChannel.send(null),
              () => deltaChannel.send(null),
            );

            // Drain deltas and yield SSE events as they stream in
            let deltaChunk = await deltaChannel.receive();
            while (deltaChunk !== null) {
              const deltaPayload: CopilotDeltaEvent = {
                tool_call_id: tc.id,
                content: deltaChunk,
                session_name: sessionName,
              };
              yield { event: "copilot-delta", data: JSON.stringify(deltaPayload) };
              deltaChunk = await deltaChannel.receive();
            }

            const stopReason = await promptPromise;
            const fullOutput = copilotConn.outputBuffer.get(tc.id) ?? "";
            const summaryPreview = fullOutput.slice(0, 200);
            const summary = `Copilot [${sessionName}] completed (${stopReason}): ${summaryPreview}`;

            const donePayload: CopilotDoneEvent = {
              tool_call_id: tc.id,
              summary,
              stop_reason: stopReason,
              session_name: sessionName,
            };
            yield { event: "copilot-done", data: JSON.stringify(donePayload) };

            copilotResult = {
              llmResult: summary,
              displayResult: fullOutput,
            };

            copilotConn.outputBuffer.delete(tc.id);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            copilotResult = {
              llmResult: `Error: copilot_agent failed: ${errMsg}`,
              displayResult: `Error: copilot_agent failed: ${errMsg}`,
            };
          }

          const isError = copilotResult.llmResult.startsWith("Error:");
          const resultPayload: ToolResultEvent = {
            id: tc.id,
            name: tc.name,
            content: copilotResult.displayResult,
            is_error: isError,
          };
          yield { event: "tool-result", data: JSON.stringify(resultPayload) };

          await addMessage(db, sessionId, "tool", copilotResult.llmResult, {
            toolCallId: tc.id,
          });
          openaiMessages.push({
            role: "tool",
            content: copilotResult.llmResult,
            tool_call_id: tc.id,
          } satisfies ChatCompletionToolMessageParam);
          continue;
        }

        let result: ToolResult;
        let isError: boolean;
        try {
          const args: Record<string, unknown> = tc.arguments
            ? (JSON.parse(tc.arguments) as Record<string, unknown>)
            : {};
          result = await tool.execute(args, workDir);
          isError = result.llmResult.startsWith("Error:");
        } catch {
          const errText = `Error: failed to parse arguments for tool '${tc.name}': ${tc.arguments}`;
          result = { llmResult: errText, displayResult: errText };
          isError = true;
        }

        // ── Create review artifact for diff tools ───────────────────
        let artifactId: string | null = null;
        const isDiffTool = tc.name === "git_diff" || tc.name === "git_show";
        if (isDiffTool && !isError && result.displayResult) {
          try {
            const args: Record<string, unknown> = tc.arguments
              ? (JSON.parse(tc.arguments) as Record<string, unknown>)
              : {};

            // Determine the "to" ref for full-text resolution
            let toRef: string;
            if (tc.name === "git_show") {
              toRef = typeof args.commit === "string" ? args.commit : "HEAD";
            } else {
              toRef = typeof args.to === "string" && args.to !== "" ? args.to : "WORKTREE";
            }

            const artifact = await createReviewArtifact({
              db,
              sessionId,
              toolName: tc.name,
              toolCallId: tc.id,
              toRef,
              diffText: result.displayResult,
              workDir,
            });

            if (artifact) {
              artifactId = artifact.artifactId;

              // Yield the review-artifact SSE event
              yield {
                event: "review-artifact",
                data: JSON.stringify(artifact.event),
              };
            }
          } catch (artErr) {
            // Non-fatal: artifact creation failure shouldn't break the agent loop
            console.error("Failed to create review artifact:", artErr);
          }
        }

        const resultPayload: ToolResultEvent = {
          id: tc.id,
          name: tc.name,
          content: result.displayResult,
          is_error: isError,
          artifact_id: artifactId,
        };
        yield { event: "tool-result", data: JSON.stringify(resultPayload) };

        await addMessage(db, sessionId, "tool", result.llmResult, {
          toolCallId: tc.id,
          artifactId,
        });
        openaiMessages.push({
          role: "tool",
          content: result.llmResult,
          tool_call_id: tc.id,
        } satisfies ChatCompletionToolMessageParam);
      }

      // Loop back — call the LLM again with tool results
      continue;
    }

    // ── Normal text response (finish_reason == "stop" or similar) ─
    if (accumulatedText) {
      await addMessage(db, sessionId, "assistant", accumulatedText);
    }

    const html = accumulatedText ? renderMarkdown(accumulatedText) : undefined;
    const donePayload: DoneEvent = { model: modelName, html: html ?? null };
    yield { event: "done", data: JSON.stringify(donePayload) };
    return;
  }

  // ── Loop limit exceeded ─────────────────────────────────────────
  const limitPayload: ErrorEvent = {
    message: `Agent loop exceeded maximum iterations (${maxIterations}).`,
  };
  yield { event: "error", data: JSON.stringify(limitPayload) };
}
