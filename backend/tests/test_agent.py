"""Tests for the agentic loop with tool calling."""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from voxpilot.config import Settings
from voxpilot.db import get_db
from voxpilot.dependencies import get_settings
from voxpilot.main import app
from voxpilot.models.schemas import (
    DoneEvent,
    ErrorEvent,
    ToolCallEvent,
    ToolResultEvent,
)
from voxpilot.services.sessions import create_session, get_messages
from voxpilot.services.streams import registry

AGENT_OPENAI_PATCH = "voxpilot.services.agent.AsyncOpenAI"


def _make_text_chunk(
    content: str | None = None,
    model: str | None = None,
    finish_reason: str | None = None,
) -> MagicMock:
    """Create a mock ChatCompletionChunk with text content."""
    chunk = MagicMock()
    choice = MagicMock()
    choice.delta.content = content
    choice.delta.tool_calls = None
    choice.finish_reason = finish_reason
    chunk.choices = [choice] if content is not None or finish_reason is not None else []
    chunk.model = model
    return chunk


def _make_tool_call_chunk(
    index: int = 0,
    call_id: str | None = None,
    name: str | None = None,
    arguments: str | None = None,
    finish_reason: str | None = None,
    model: str | None = None,
) -> MagicMock:
    """Create a mock ChatCompletionChunk with a tool call delta."""
    chunk = MagicMock()
    choice = MagicMock()
    choice.delta.content = None

    tc_delta = MagicMock()
    tc_delta.index = index
    tc_delta.id = call_id
    tc_delta.function = MagicMock() if (name or arguments) else None
    if tc_delta.function:
        tc_delta.function.name = name
        tc_delta.function.arguments = arguments

    choice.delta.tool_calls = [tc_delta]
    choice.finish_reason = finish_reason
    chunk.choices = [choice]
    chunk.model = model
    return chunk


async def _mock_stream(
    chunks: list[MagicMock],
) -> AsyncIterator[MagicMock]:
    """Yield mock chunks as an async iterator."""
    for chunk in chunks:
        yield chunk


def _parse_sse_events(text: str) -> list[tuple[str, str]]:
    """Parse SSE text into (event_type, data_json) pairs."""
    events: list[tuple[str, str]] = []
    event_type = ""
    data = ""
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.startswith("event:"):
            event_type = line[len("event:"):].strip()
        elif line.startswith("data:"):
            data = line[len("data:"):].strip()
        elif line == "" and event_type and data:
            events.append((event_type, data))
            event_type = ""
            data = ""
    if event_type and data:
        events.append((event_type, data))
    return events


async def _create_test_session() -> str:
    db = get_db()
    session = await create_session(db)
    return session.id


async def _wait_for_queue(
    session_id: str,
) -> asyncio.Queue[dict[str, Any] | None]:
    for _ in range(200):
        q = registry.get(session_id)
        if q is not None:
            return q
        await asyncio.sleep(0.01)
    raise RuntimeError(f"Stream queue for {session_id} never registered")


@pytest.mark.asyncio
async def test_agent_loop_with_tool_call(client: httpx.AsyncClient) -> None:
    """Full flow: LLM calls a tool, gets result, then responds with text."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    # First LLM call: returns a tool call for list_directory
    tool_call_chunks = [
        _make_tool_call_chunk(
            index=0,
            call_id="call_123",
            name="list_directory",
            arguments='{"pat',
        ),
        _make_tool_call_chunk(
            index=0,
            arguments='h": "."}',
            finish_reason="tool_calls",
        ),
    ]

    # Second LLM call: returns text after seeing tool result
    text_chunks = [
        _make_text_chunk(content="Here are the files.", model="gpt-4o"),
        _make_text_chunk(finish_reason="stop", model="gpt-4o"),
    ]

    call_count = 0

    async def _mock_create(**kwargs: str) -> AsyncIterator[MagicMock]:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return _mock_stream(tool_call_chunks)
        return _mock_stream(text_chunks)

    with patch(AGENT_OPENAI_PATCH) as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=_mock_create)
        mock_openai_cls.return_value = mock_client

        async def _feed() -> None:
            q = await _wait_for_queue(session_id)
            await q.put({
                "content": "What files are here?",
                "model": "gpt-4o",
                "gh_token": "gho_fake",
            })
            await asyncio.sleep(0.3)
            await q.put(None)

        feed_task = asyncio.create_task(_feed())
        response = await client.get(f"/api/sessions/{session_id}/stream")
        await feed_task

    events = _parse_sse_events(response.text)
    event_types = [t for t, _ in events]

    # Should contain: ready, message (user), tool-call, tool-result, text-delta, done
    assert "ready" in event_types
    assert "tool-call" in event_types
    assert "tool-result" in event_types
    assert "text-delta" in event_types
    assert "done" in event_types

    # Verify tool-call event content
    tc_events = [(t, d) for t, d in events if t == "tool-call"]
    assert len(tc_events) == 1
    tc = ToolCallEvent.model_validate_json(tc_events[0][1])
    assert tc.id == "call_123"
    assert tc.name == "list_directory"

    # Verify tool-result event content
    tr_events = [(t, d) for t, d in events if t == "tool-result"]
    assert len(tr_events) == 1
    tr = ToolResultEvent.model_validate_json(tr_events[0][1])
    assert tr.id == "call_123"
    assert tr.name == "list_directory"
    assert tr.is_error is False

    # Verify done
    done_events = [(t, d) for t, d in events if t == "done"]
    done = DoneEvent.model_validate_json(done_events[0][1])
    assert done.model == "gpt-4o"

    # Verify LLM was called twice
    assert call_count == 2


@pytest.mark.asyncio
async def test_agent_loop_persists_tool_messages(
    client: httpx.AsyncClient,
) -> None:
    """Tool call/result messages should be persisted in the DB."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    tool_call_chunks = [
        _make_tool_call_chunk(
            index=0,
            call_id="call_abc",
            name="read_file",
            arguments='{"path": "nonexistent.txt"}',
            finish_reason="tool_calls",
        ),
    ]
    text_chunks = [
        _make_text_chunk(
            content="The file doesn't exist.", model="gpt-4o", finish_reason="stop"
        ),
    ]

    call_count = 0

    async def _mock_create(**kwargs: str) -> AsyncIterator[MagicMock]:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return _mock_stream(tool_call_chunks)
        return _mock_stream(text_chunks)

    with patch(AGENT_OPENAI_PATCH) as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=_mock_create)
        mock_openai_cls.return_value = mock_client

        async def _feed() -> None:
            q = await _wait_for_queue(session_id)
            await q.put({
                "content": "Read a file",
                "model": "gpt-4o",
                "gh_token": "gho_fake",
            })
            await asyncio.sleep(0.3)
            await q.put(None)

        feed_task = asyncio.create_task(_feed())
        await client.get(f"/api/sessions/{session_id}/stream")
        await feed_task

    db = get_db()
    messages = await get_messages(db, session_id)

    # Should have: user, assistant (with tool_calls), tool, assistant (final text)
    assert len(messages) == 4
    assert messages[0].role == "user"
    assert messages[1].role == "assistant"
    assert messages[1].tool_calls is not None
    assert len(messages[1].tool_calls) == 1
    assert messages[1].tool_calls[0].name == "read_file"
    assert messages[2].role == "tool"
    assert messages[2].tool_call_id == "call_abc"
    assert "Error:" in messages[2].content  # file doesn't exist
    assert messages[3].role == "assistant"
    assert messages[3].content == "The file doesn't exist."


@pytest.mark.asyncio
async def test_agent_loop_iteration_limit(
    client: httpx.AsyncClient,
) -> None:
    """Agent loop should stop after max iterations and emit an error."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    # Always return tool calls (never text) to trigger loop limit
    def _always_tool_call() -> list[MagicMock]:
        return [
            _make_tool_call_chunk(
                index=0,
                call_id="call_loop",
                name="list_directory",
                arguments='{"path": "."}',
                finish_reason="tool_calls",
            ),
        ]

    async def _mock_create(**kwargs: str) -> AsyncIterator[MagicMock]:
        return _mock_stream(_always_tool_call())

    # Override settings to use max_iterations=3 for faster test
    def _override_settings() -> Settings:
        return Settings(max_agent_iterations=3)

    app.dependency_overrides[get_settings] = _override_settings
    try:
        with patch(AGENT_OPENAI_PATCH) as mock_openai_cls:
            mock_client_instance = MagicMock()
            mock_client_instance.chat.completions.create = AsyncMock(
                side_effect=_mock_create
            )
            mock_openai_cls.return_value = mock_client_instance

            async def _feed() -> None:
                q = await _wait_for_queue(session_id)
                await q.put({
                    "content": "Loop forever",
                    "model": "gpt-4o",
                    "gh_token": "gho_fake",
                })
                await asyncio.sleep(1.0)
                await q.put(None)

            feed_task = asyncio.create_task(_feed())
            response = await client.get(f"/api/sessions/{session_id}/stream")
            await feed_task
    finally:
        app.dependency_overrides.pop(get_settings, None)

    events = _parse_sse_events(response.text)
    error_events = [(t, d) for t, d in events if t == "error"]
    assert len(error_events) >= 1

    err = ErrorEvent.model_validate_json(error_events[-1][1])
    assert (
        "maximum iterations" in err.message.lower()
        or "exceeded" in err.message.lower()
    )


@pytest.mark.asyncio
async def test_agent_loop_unknown_tool(client: httpx.AsyncClient) -> None:
    """Unknown tool names should return an error to the LLM, not crash."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    tool_call_chunks = [
        _make_tool_call_chunk(
            index=0,
            call_id="call_unknown",
            name="nonexistent_tool",
            arguments="{}",
            finish_reason="tool_calls",
        ),
    ]
    text_chunks = [
        _make_text_chunk(
            content="Sorry, that tool doesn't exist.",
            model="gpt-4o",
            finish_reason="stop",
        ),
    ]

    call_count = 0

    async def _mock_create(**kwargs: str) -> AsyncIterator[MagicMock]:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return _mock_stream(tool_call_chunks)
        return _mock_stream(text_chunks)

    with patch(AGENT_OPENAI_PATCH) as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=_mock_create)
        mock_openai_cls.return_value = mock_client

        async def _feed() -> None:
            q = await _wait_for_queue(session_id)
            await q.put({
                "content": "Use a weird tool",
                "model": "gpt-4o",
                "gh_token": "gho_fake",
            })
            await asyncio.sleep(0.3)
            await q.put(None)

        feed_task = asyncio.create_task(_feed())
        response = await client.get(f"/api/sessions/{session_id}/stream")
        await feed_task

    events = _parse_sse_events(response.text)

    # Should have tool-result with error
    tr_events = [(t, d) for t, d in events if t == "tool-result"]
    assert len(tr_events) == 1
    tr = ToolResultEvent.model_validate_json(tr_events[0][1])
    assert tr.is_error is True
    assert "unknown tool" in tr.content.lower()

    # Should still complete with done (LLM recovers)
    assert "done" in [t for t, _ in events]


@pytest.mark.asyncio
async def test_agent_loop_no_tools_text_only(
    client: httpx.AsyncClient,
) -> None:
    """When the LLM doesn't call any tools, it should behave like before."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    chunks = [
        _make_text_chunk(content="Just a plain answer.", model="gpt-4o"),
        _make_text_chunk(finish_reason="stop", model="gpt-4o"),
    ]
    mock_create = AsyncMock(return_value=_mock_stream(chunks))

    with patch(AGENT_OPENAI_PATCH) as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = mock_create
        mock_openai_cls.return_value = mock_client

        async def _feed() -> None:
            q = await _wait_for_queue(session_id)
            await q.put({
                "content": "What is 2+2?",
                "model": "gpt-4o",
                "gh_token": "gho_fake",
            })
            await asyncio.sleep(0.2)
            await q.put(None)

        feed_task = asyncio.create_task(_feed())
        response = await client.get(f"/api/sessions/{session_id}/stream")
        await feed_task

    events = _parse_sse_events(response.text)
    event_types = [t for t, _ in events]

    # No tool events
    assert "tool-call" not in event_types
    assert "tool-result" not in event_types

    # Normal flow
    assert "text-delta" in event_types
    assert "done" in event_types


@pytest.mark.asyncio
async def test_history_replay_includes_tool_messages(
    client: httpx.AsyncClient,
) -> None:
    """Tool call/result messages should be replayed in history on reconnect."""
    from voxpilot.services.sessions import add_message

    session_id = await _create_test_session()
    db = get_db()

    # Manually insert messages mimicking a tool call conversation
    await add_message(db, session_id, "user", "Read a file")
    await add_message(
        db,
        session_id,
        "assistant",
        "",
        tool_calls=json.dumps(
            [{"id": "call_hist", "name": "read_file", "arguments": '{"path": "x.py"}'}]
        ),
    )
    await add_message(
        db, session_id, "tool", "Error: file 'x.py' does not exist.",
        tool_call_id="call_hist",
    )
    await add_message(db, session_id, "assistant", "The file was not found.")

    client.cookies.set("gh_token", "gho_fake")

    async def _feed_sentinel() -> None:
        q = await _wait_for_queue(session_id)
        await q.put(None)

    feed_task = asyncio.create_task(_feed_sentinel())
    response = await client.get(f"/api/sessions/{session_id}/stream")
    await feed_task

    events = _parse_sse_events(response.text)
    msg_events = [(t, d) for t, d in events if t == "message"]

    assert len(msg_events) == 4

    # First: user message
    m0 = json.loads(msg_events[0][1])
    assert m0["role"] == "user"

    # Second: assistant with tool_calls
    m1 = json.loads(msg_events[1][1])
    assert m1["role"] == "assistant"
    assert m1["tool_calls"] is not None
    assert len(m1["tool_calls"]) == 1
    assert m1["tool_calls"][0]["name"] == "read_file"

    # Third: tool result
    m2 = json.loads(msg_events[2][1])
    assert m2["role"] == "tool"
    assert m2["tool_call_id"] == "call_hist"
    assert "Error:" in m2["content"]

    # Fourth: final assistant text
    m3 = json.loads(msg_events[3][1])
    assert m3["role"] == "assistant"
    assert m3["content"] == "The file was not found."
