/** Deterministic HTTP model fixture; OpenCode still owns sessions and tool execution. */
export const baselineText =
  "# Baseline response\n\nBrowser baseline passed.\n\n- First item\n- Second item\n\n```text\nbaseline code\n```";

function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(value) === false
  );
}

function array(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (array(value)) return value.map(text).join("\n");
  if (record(value) && typeof value.text === "string") return value.text;
  return "";
}

export function startProvider(options: { port: number; workdir: string }) {
  let requests = 0;
  let activeStreams = 0;
  let cancelledStreams = 0;
  let sequence = 0;

  return Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    reusePort: false,
    idleTimeout: 60,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/health") {
        return Response.json({
          status: "ok",
          requests,
          activeStreams,
          cancelledStreams,
        });
      }
      if (path === "/v1/models") {
        return Response.json({
          object: "list",
          data: [
            {
              id: "baseline",
              object: "model",
              created: 0,
              owned_by: "fixture",
            },
          ],
        });
      }
      if (path !== "/v1/chat/completions" || request.method !== "POST") {
        return new Response("Not found", { status: 404 });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: { message: "Invalid JSON" } },
          { status: 400 },
        );
      }
      if (record(body) === false || array(body.messages) === false) {
        return Response.json(
          { error: { message: "Expected messages array" } },
          { status: 400 },
        );
      }
      requests += 1;
      const messages = body.messages.filter(record);
      const lastUser = messages.findLastIndex(
        (message) =>
          message.role === "user" && /BASELINE_/.test(text(message.content)),
      );
      const prompt = text(messages[lastUser]?.content);
      const protocol = prompt.match(
        /BASELINE_(TEXT|LONG|QUESTION|DIFF|PERMISSION)\b/,
      )?.[1];
      const tools = array(body.tools) ? body.tools.filter(record) : [];
      const toolNames = tools.flatMap((tool) => {
        if (record(tool.function) && typeof tool.function.name === "string") {
          return [tool.function.name];
        }
        return [];
      });
      const isTitle = tools.length === 0;
      const answered = messages
        .slice(lastUser + 1)
        .some((message) => message.role === "tool");
      let output = isTitle ? "Browser baseline" : baselineText;
      let toolCall:
        | {
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }
        | undefined;

      if (isTitle === false && answered) {
        output =
          protocol === "QUESTION"
            ? "Question answered."
            : protocol === "DIFF"
              ? "Diff ready."
              : protocol === "PERMISSION"
                ? "Permission answered."
                : "Tool completed.";
      } else if (
        isTitle === false &&
        (protocol === "QUESTION" ||
          protocol === "DIFF" ||
          protocol === "PERMISSION")
      ) {
        const target =
          protocol === "QUESTION"
            ? "question"
            : protocol === "DIFF"
              ? "voxpilot_show_diff"
              : "shell";
        const name =
          toolNames.find(
            (candidate) =>
              candidate === target || candidate.endsWith(`_${target}`),
          ) ??
          (protocol === "DIFF"
            ? toolNames.find((candidate) => candidate.endsWith("show_diff"))
            : undefined);
        if (name === undefined) {
          console.error(
            `[fixture] Missing ${target}; available tools: ${toolNames.join(", ")}`,
          );
          return Response.json(
            { error: { message: `Missing fixture tool: ${target}` } },
            { status: 422 },
          );
        }
        // V2's question tool creates a form: q0 is a string field with these options.
        const args =
          protocol === "QUESTION"
            ? {
                questions: [
                  {
                    question: "Select an option",
                    header: "Baseline question",
                    multiple: false,
                    options: [
                      { label: "Alpha", description: "First option" },
                      { label: "Beta", description: "Second option" },
                    ],
                  },
                ],
              }
            : protocol === "DIFF"
              ? {
                  from: "HEAD",
                  to: "WORKTREE",
                  workdir: options.workdir,
                }
              : {
                  command: "printf baseline-permission",
                  workdir: options.workdir,
                };
        toolCall = {
          id: `call_baseline_${++sequence}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        };
      }

      const id = `chatcmpl-baseline-${++sequence}`;
      const created = 0;
      const model = "baseline";
      const usage = {
        prompt_tokens: 32,
        completion_tokens: 32,
        total_tokens: 64,
      };
      console.log(
        `[fixture] ${id} ${isTitle ? "title" : (protocol ?? "TEXT")} ${toolCall?.function.name ?? (answered ? "answered" : "text")} tools=${toolNames.length}`,
      );
      if (body.stream !== true) {
        return Response.json({
          id,
          object: "chat.completion",
          created,
          model,
          choices: [
            {
              index: 0,
              message: toolCall
                ? { role: "assistant", content: null, tool_calls: [toolCall] }
                : { role: "assistant", content: output },
              finish_reason: toolCall ? "tool_calls" : "stop",
            },
          ],
          usage,
        });
      }

      const encoder = new TextEncoder();
      let closed = false;
      activeStreams += 1;
      const finish = (cancelled: boolean) => {
        if (closed) return;
        closed = true;
        activeStreams -= 1;
        if (cancelled) cancelledStreams += 1;
      };
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (delta: unknown, reason: string | null = null) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [{ index: 0, delta, finish_reason: reason }],
                  ...(reason === null ? {} : { usage }),
                })}\n\n`,
              ),
            );
          };
          const abort = () => {
            if (closed) return;
            finish(true);
            controller.close();
          };
          request.signal.addEventListener("abort", abort, { once: true });
          const pump = async () => {
            try {
              if (request.signal.aborted) {
                abort();
                return;
              }
              send({ role: "assistant", content: "" });
              const chunks = toolCall
                ? [""]
                : protocol === "LONG" && isTitle === false && answered === false
                  ? Array.from(
                      { length: 100 },
                      (_, index) => `Streaming baseline chunk ${index + 1}.\n`,
                    )
                  : (output.match(/[\s\S]{1,8}/g) ?? [output]);
              for (const chunk of chunks) {
                await Bun.sleep(150);
                if (closed) return;
                if (toolCall) send({ tool_calls: [{ index: 0, ...toolCall }] });
                else send({ content: chunk });
              }
              send({}, toolCall ? "tool_calls" : "stop");
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              finish(false);
              controller.close();
            } catch (error) {
              if (closed === false) {
                finish(true);
                controller.error(error);
              }
            } finally {
              request.signal.removeEventListener("abort", abort);
            }
          };
          void pump();
        },
        cancel() {
          finish(true);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    },
  });
}
