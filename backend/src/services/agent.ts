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
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat/completions";
import { config } from "../config";
import type { getDb } from "../db";
import type { ChatMessage, ToolCallInfo } from "../schemas/api";
import type {
  CopilotDeltaEvent,
  CopilotDoneEvent,
  DoneEvent,
  ErrorEvent,
  TextDeltaEvent,
  ToolCallEvent,
  ToolConfirmEvent,
  ToolResultEvent,
} from "../schemas/events";
import type { ToolResult } from "../tools";
import {
  copilotAgentParameters,
  defaultRegistry,
  gitDiffParameters,
  gitShowParameters,
  parseJsonArgs,
  safeParseJsonArgs,
} from "../tools";
import { createReviewArtifact } from "./artifact-pipeline";
import { getConnection } from "./copilot-acp";
import { renderMarkdown } from "./markdown";
import { addMessage } from "./sessions";
import { AsyncChannel } from "./streams";

type Db = ReturnType<typeof getDb>;

// ── SSE event types ─────────────────────────────────────────────────────────

export interface SseEvent {
  event: string;
  data: string;
}

// ── Convert ChatMessage → OpenAI SDK message param ──────────────────────────

function toMessageParam(m: ChatMessage): ChatCompletionMessageParam {
  if (m.role === "system") {
    return {
      role: "system",
      content: m.content,
    } satisfies ChatCompletionSystemMessageParam;
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
    return {
      role: "assistant",
      content: m.content,
    } satisfies ChatCompletionAssistantMessageParam;
  }

  return {
    role: "user",
    content: m.content,
  } satisfies ChatCompletionUserMessageParam;
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
  model?: string;
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
    workDir,
    db,
    sessionId,
    maxIterations = 25,
    isDisconnected,
    requestConfirmation,
  } = opts;

  const openaiMessages: ChatCompletionMessageParam[] =
    messages.map(toMessageParam);
  const toolsSpec = defaultRegistry.toOpenAiTools();

  const client = new OpenAI({
    baseURL: config.llmBaseUrl,
    apiKey: config.llmApiKey,
  });

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const resolvedModel = model ?? config.llmDefaultModel;
    let modelName = resolvedModel;
    let accumulatedText = "";
    const toolCallMap = new Map<number, StreamedToolCall>();
    let finishReason: string | null = null;

    try {
      console.log(
        `[agent] iteration=${iteration} sending ${openaiMessages.length} messages to model=${resolvedModel}`,
      );
      for (const msg of openaiMessages) {
        const preview =
          typeof msg.content === "string"
            ? msg.content.slice(0, 120)
            : "(structured)";
        const extra =
          msg.role === "assistant" && "tool_calls" in msg && msg.tool_calls
            ? ` tool_calls=${msg.tool_calls.length}`
            : msg.role === "tool" && "tool_call_id" in msg
              ? ` tool_call_id=${msg.tool_call_id}`
              : "";
        console.log(`[agent]   role=${msg.role}${extra} content=${preview}`);
      }

      const llmStream = await client.chat.completions.create({
        model: resolvedModel,
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
        // The API may use non-zero-based indices (e.g. Copilot/Claude
        // sends index=1 for the first tool call), so we use a Map.
        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index;
            if (!toolCallMap.has(idx)) {
              toolCallMap.set(idx, new StreamedToolCall());
            }
            const tc = toolCallMap.get(idx);
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

      // Log detailed error info for API errors (e.g. 400 Bad Request)
      if (exc instanceof OpenAI.APIError) {
        console.error(
          `[agent] API error: status=${exc.status} type=${exc.type ?? "unknown"} code=${exc.code ?? "unknown"}`,
        );
        console.error(
          "[agent] API error body:",
          JSON.stringify(exc.error, null, 2),
        );
        console.error(
          "[agent] Request had",
          openaiMessages.length,
          "messages. Last 3:",
        );
        for (const msg of openaiMessages.slice(-3)) {
          console.error("[agent]  ", JSON.stringify(msg).slice(0, 500));
        }
      } else {
        console.error("[agent] Non-API error:", exc);
      }

      const payload: ErrorEvent = { message: errorMsg };
      yield { event: "error", data: JSON.stringify(payload) };
      return;
    }

    // ── Handle finish reason ──────────────────────────────────────
    const toolCalls = Array.from(toolCallMap.values());
    if (finishReason === "tool_calls" && toolCalls.length > 0) {
      // Abort if any streamed tool call has an empty id or name — this
      // indicates a streaming gap and we must not persist bad data.
      const malformed = toolCalls.filter((tc) => !tc.id || !tc.name);
      if (malformed.length > 0) {
        for (const tc of malformed) {
          console.error(
            `[agent] Malformed streamed tool call: id=${JSON.stringify(tc.id)} name=${JSON.stringify(tc.name)} args=${tc.arguments.slice(0, 80)}`,
          );
        }
        const payload: ErrorEvent = {
          message: `LLM returned ${malformed.length} tool call(s) with missing id/name. This is a streaming error — please retry.`,
        };
        yield { event: "error", data: JSON.stringify(payload) };
        return;
      }

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
            const args = parseJsonArgs(copilotAgentParameters, tc.arguments);
            const promptText = args.prompt;
            const sessionName = args.session_name;

            const copilotConn = await getConnection(sessionId, workDir);
            await copilotConn.getOrCreateSession(sessionName, workDir);
            copilotConn.outputBuffer.set(tc.id, "");
            copilotConn.outputSessionNames.set(tc.id, sessionName);

            const deltaChannel = new AsyncChannel<string | null>();
            const promptPromise = copilotConn.prompt(
              sessionName,
              promptText,
              (content) => {
                const prev = copilotConn.outputBuffer.get(tc.id) ?? "";
                copilotConn.outputBuffer.set(tc.id, prev + content);
                deltaChannel.send(content);
              },
            );

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
              yield {
                event: "copilot-delta",
                data: JSON.stringify(deltaPayload),
              };
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
            copilotConn.outputSessionNames.delete(tc.id);
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
          result = await defaultRegistry.execute(
            tc.name,
            tc.arguments,
            workDir,
          );
          isError = result.llmResult.startsWith("Error:");
        } catch (err) {
          const errText = `Error: failed to execute tool '${tc.name}': ${err instanceof Error ? err.message : String(err)}`;
          result = { llmResult: errText, displayResult: errText };
          isError = true;
        }

        // ── Create review artifact for diff tools ───────────────────
        let artifactId: string | null = null;
        const isDiffTool = tc.name === "git_diff" || tc.name === "git_show";
        if (isDiffTool && !isError && result.displayResult) {
          try {
            // Determine the "to" ref for full-text resolution
            let toRef: string;
            if (tc.name === "git_show") {
              const parsed = safeParseJsonArgs(gitShowParameters, tc.arguments);
              toRef = parsed.success ? parsed.data.commit : "HEAD";
            } else {
              const parsed = safeParseJsonArgs(gitDiffParameters, tc.arguments);
              toRef = parsed.success ? parsed.data.to : "WORKTREE";
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
