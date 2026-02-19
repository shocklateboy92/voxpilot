"""Agentic loop — call LLM, execute tools, feed results back, repeat.

The ``run_agent_loop`` async generator yields SSE-ready dicts that the
chat route streams to the frontend.  It handles:

- Streaming text deltas from every LLM call
- Detecting tool-call finish reasons and executing tools
- Persisting assistant + tool messages to the DB
- Capping iterations to prevent runaway loops
"""

import json
import logging
from collections.abc import AsyncGenerator, Callable, Coroutine
from pathlib import Path
from typing import Any

import aiosqlite
from openai import AsyncOpenAI, OpenAIError
from openai.types.chat import (
    ChatCompletionAssistantMessageParam,
    ChatCompletionChunk,
    ChatCompletionMessageParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionToolMessageParam,
    ChatCompletionUserMessageParam,
)

from voxpilot.models.schemas import (
    ChatMessage,
    DoneEvent,
    ErrorEvent,
    TextDeltaEvent,
    ToolCallEvent,
    ToolCallInfo,
    ToolConfirmEvent,
    ToolResultEvent,
)
from voxpilot.services.sessions import add_message
from voxpilot.services.tools import default_registry

logger = logging.getLogger(__name__)

GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com"


def _to_message_param(m: ChatMessage) -> ChatCompletionMessageParam:
    """Convert a ChatMessage to an OpenAI SDK message param."""
    if m.role == "system":
        return ChatCompletionSystemMessageParam(role="system", content=m.content)

    if m.role == "tool":
        return ChatCompletionToolMessageParam(
            role="tool",
            content=m.content,
            tool_call_id=m.tool_call_id or "",
        )

    if m.role == "assistant":
        if m.tool_calls:
            return ChatCompletionAssistantMessageParam(
                role="assistant",
                content=m.content or None,
                tool_calls=[
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.name, "arguments": tc.arguments},
                    }
                    for tc in m.tool_calls
                ],
            )
        return ChatCompletionAssistantMessageParam(role="assistant", content=m.content)

    return ChatCompletionUserMessageParam(role="user", content=m.content)


# ── Accumulated tool call from streaming ──────────────────────────────────────


class _StreamedToolCall:
    """Accumulate incremental tool-call deltas from streaming chunks."""

    def __init__(self, call_id: str, name: str) -> None:
        self.id = call_id
        self.name = name
        self.arguments = ""


# ── Agent loop ────────────────────────────────────────────────────────────────


async def run_agent_loop(
    messages: list[ChatMessage],
    model: str,
    gh_token: str,
    work_dir: Path,
    db: aiosqlite.Connection,
    session_id: str,
    max_iterations: int = 25,
    is_disconnected: Callable[[], Coroutine[Any, Any, bool]] | None = None,
    request_confirmation: Callable[[str, str, str], Coroutine[Any, Any, bool]] | None = None,
) -> AsyncGenerator[dict[str, str]]:
    """Run the agentic loop, yielding ``(event_type, data_json)`` dicts.

    Yields dicts with ``{"event": ..., "data": ...}`` suitable for
    constructing ``ServerSentEvent`` instances.
    """
    openai_messages: list[ChatCompletionMessageParam] = [
        _to_message_param(m) for m in messages
    ]

    tools_spec = default_registry.to_openai_tools()

    for _iteration in range(max_iterations):
        client = AsyncOpenAI(
            base_url=GITHUB_MODELS_BASE_URL,
            api_key=gh_token,
        )

        model_name = model
        accumulated_text = ""
        tool_calls: list[_StreamedToolCall] = []
        finish_reason: str | None = None

        try:
            llm_stream = await client.chat.completions.create(
                model=model,
                messages=openai_messages,
                tools=tools_spec,
                stream=True,
            )

            chunk: ChatCompletionChunk
            async for chunk in llm_stream:
                if is_disconnected and await is_disconnected():
                    return

                choice = chunk.choices[0] if chunk.choices else None
                if not choice:
                    if chunk.model:
                        model_name = chunk.model
                    continue

                delta = choice.delta

                # Accumulate text content
                if delta.content:
                    accumulated_text += delta.content
                    yield {
                        "event": "text-delta",
                        "data": TextDeltaEvent(
                            content=delta.content
                        ).model_dump_json(),
                    }

                # Accumulate tool calls (streamed incrementally)
                if delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        # Extend list if needed
                        while len(tool_calls) <= idx:
                            tool_calls.append(_StreamedToolCall("", ""))
                        tc = tool_calls[idx]
                        if tc_delta.id:
                            tc.id = tc_delta.id
                        if tc_delta.function:
                            if tc_delta.function.name:
                                tc.name = tc_delta.function.name
                            if tc_delta.function.arguments:
                                tc.arguments += tc_delta.function.arguments

                if choice.finish_reason:
                    finish_reason = choice.finish_reason
                if chunk.model:
                    model_name = chunk.model

        except OpenAIError as exc:
            logger.exception("OpenAI API error during agent loop")
            if accumulated_text:
                await add_message(db, session_id, "assistant", accumulated_text)
            yield {
                "event": "error",
                "data": ErrorEvent(message=str(exc)).model_dump_json(),
            }
            return
        except Exception as exc:
            logger.exception("Unexpected error during agent loop")
            if accumulated_text:
                await add_message(db, session_id, "assistant", accumulated_text)
            yield {
                "event": "error",
                "data": ErrorEvent(message=str(exc)).model_dump_json(),
            }
            return

        # ── Handle finish reason ──────────────────────────────────────
        if finish_reason == "tool_calls" and tool_calls:
            # Persist the assistant message with tool calls
            tool_call_infos = [
                ToolCallInfo(id=tc.id, name=tc.name, arguments=tc.arguments)
                for tc in tool_calls
            ]
            await add_message(
                db,
                session_id,
                "assistant",
                accumulated_text,
                tool_calls=json.dumps(
                    [tc.model_dump() for tc in tool_call_infos]
                ),
            )

            # Add assistant message to conversation for the next LLM call
            openai_messages.append(
                ChatCompletionAssistantMessageParam(
                    role="assistant",
                    content=accumulated_text or None,
                    tool_calls=[
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": tc.arguments,
                            },
                        }
                        for tc in tool_calls
                    ],
                )
            )

            # Execute each tool
            for tc in tool_calls:
                yield {
                    "event": "tool-call",
                    "data": ToolCallEvent(
                        id=tc.id, name=tc.name, arguments=tc.arguments
                    ).model_dump_json(),
                }

                tool = default_registry.get(tc.name)
                if tool is None:
                    result_text = f"Error: unknown tool '{tc.name}'."
                    is_error = True
                else:
                    # Check if tool requires user confirmation
                    if tool.requires_confirmation:
                        yield {
                            "event": "tool-confirm",
                            "data": ToolConfirmEvent(
                                id=tc.id, name=tc.name, arguments=tc.arguments
                            ).model_dump_json(),
                        }
                        if request_confirmation is None:
                            logger.warning(
                                "Tool '%s' requires confirmation but no handler — auto-declining",
                                tc.name,
                            )
                            approved = False
                        else:
                            approved = await request_confirmation(
                                tc.id, tc.name, tc.arguments
                            )

                        if not approved:
                            result_text = (
                                "Error: user declined to run this tool."
                            )
                            is_error = True

                            yield {
                                "event": "tool-result",
                                "data": ToolResultEvent(
                                    id=tc.id,
                                    name=tc.name,
                                    content=result_text,
                                    is_error=is_error,
                                ).model_dump_json(),
                            }
                            await add_message(
                                db, session_id, "tool", result_text, tool_call_id=tc.id,
                            )
                            openai_messages.append(
                                ChatCompletionToolMessageParam(
                                    role="tool", content=result_text, tool_call_id=tc.id,
                                )
                            )
                            continue

                    try:
                        args: dict[str, Any] = (
                            json.loads(tc.arguments) if tc.arguments else {}
                        )
                    except json.JSONDecodeError:
                        args = {}
                        result_text = (
                            f"Error: failed to parse arguments for tool "
                            f"'{tc.name}': {tc.arguments}"
                        )
                        is_error = True
                    else:
                        result_text = await tool.execute(args, work_dir)
                        is_error = result_text.startswith("Error:")

                yield {
                    "event": "tool-result",
                    "data": ToolResultEvent(
                        id=tc.id,
                        name=tc.name,
                        content=result_text,
                        is_error=is_error,
                    ).model_dump_json(),
                }

                # Persist tool result
                await add_message(
                    db,
                    session_id,
                    "tool",
                    result_text,
                    tool_call_id=tc.id,
                )

                # Add to conversation for next LLM call
                openai_messages.append(
                    ChatCompletionToolMessageParam(
                        role="tool",
                        content=result_text,
                        tool_call_id=tc.id,
                    )
                )

            # Loop back — call the LLM again with tool results
            continue

        # ── Normal text response (finish_reason == "stop" or similar) ─
        if accumulated_text:
            await add_message(db, session_id, "assistant", accumulated_text)

        yield {
            "event": "done",
            "data": DoneEvent(model=model_name).model_dump_json(),
        }
        return

    # ── Loop limit exceeded ───────────────────────────────────────────
    logger.warning(
        "Agent loop hit iteration limit (%d) for session %s",
        max_iterations,
        session_id,
    )
    yield {
        "event": "error",
        "data": ErrorEvent(
            message=f"Agent loop exceeded maximum iterations ({max_iterations})."
        ).model_dump_json(),
    }
