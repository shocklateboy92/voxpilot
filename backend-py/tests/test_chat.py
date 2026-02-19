"""Tests for session-scoped SSE stream and message submission endpoints."""

import asyncio
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from voxpilot.db import get_db
from voxpilot.models.schemas import DoneEvent, ErrorEvent, MessageEvent, TextDeltaEvent
from voxpilot.services.sessions import add_message, create_session
from voxpilot.services.streams import registry

AGENT_OPENAI_PATCH = "voxpilot.services.agent.AsyncOpenAI"


def _make_chunk(
    content: str | None = None,
    model: str | None = None,
    finish_reason: str | None = None,
) -> MagicMock:
    """Create a mock ChatCompletionChunk."""
    chunk = MagicMock()
    choice = MagicMock()
    choice.delta.content = content
    choice.delta.tool_calls = None
    choice.finish_reason = finish_reason
    chunk.choices = [choice] if content is not None or finish_reason is not None else []
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
    """Create a session and return its ID."""
    db = get_db()
    session = await create_session(db)
    return session.id


async def _wait_for_queue(
    session_id: str,
) -> asyncio.Queue[dict[str, Any] | None]:
    """Poll until the stream registers a queue, then return it."""
    for _ in range(200):
        q = registry.get(session_id)
        if q is not None:
            return q
        await asyncio.sleep(0.01)
    raise RuntimeError(f"Stream queue for {session_id} never registered")


# ── POST /api/sessions/{id}/messages tests ────────────────────────────────────


@pytest.mark.asyncio
async def test_send_message_returns_202(client: httpx.AsyncClient) -> None:
    """POST /messages with an active stream should return 202."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    # Simulate an active stream by registering a queue
    registry.register(session_id)
    try:
        response = await client.post(
            f"/api/sessions/{session_id}/messages",
            json={"content": "Hello", "model": "gpt-4o"},
        )
        assert response.status_code == 202
    finally:
        registry.unregister(session_id)


@pytest.mark.asyncio
async def test_send_message_returns_409_without_stream(
    client: httpx.AsyncClient,
) -> None:
    """POST /messages without an active stream should return 409."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    response = await client.post(
        f"/api/sessions/{session_id}/messages",
        json={"content": "Hello", "model": "gpt-4o"},
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_send_message_returns_401_without_cookie(
    client: httpx.AsyncClient,
) -> None:
    """POST /messages without auth cookie should return 401."""
    response = await client.post(
        "/api/sessions/some-id/messages",
        json={"content": "Hi"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_send_message_returns_404_for_invalid_session(
    client: httpx.AsyncClient,
) -> None:
    """POST /messages with non-existent session should return 404."""
    client.cookies.set("gh_token", "gho_fake")
    response = await client.post(
        "/api/sessions/nonexistent/messages",
        json={"content": "Hi"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_send_message_enqueues_payload(
    client: httpx.AsyncClient,
) -> None:
    """POST /messages should place the correct payload on the queue."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake_token_123")

    queue = registry.register(session_id)
    try:
        await client.post(
            f"/api/sessions/{session_id}/messages",
            json={"content": "Hello world", "model": "gpt-4o"},
        )
        payload = queue.get_nowait()
        assert payload is not None
        assert payload["content"] == "Hello world"
        assert payload["model"] == "gpt-4o"
        assert payload["gh_token"] == "gho_fake_token_123"  # noqa: S105
    finally:
        registry.unregister(session_id)


# ── GET /api/sessions/{id}/stream tests ───────────────────────────────────────


@pytest.mark.asyncio
async def test_stream_replays_history(client: httpx.AsyncClient) -> None:
    """GET /stream should replay existing messages, then send ready."""
    session_id = await _create_test_session()
    db = get_db()
    await add_message(db, session_id, "user", "Hello")
    await add_message(db, session_id, "assistant", "Hi there!")

    client.cookies.set("gh_token", "gho_fake")

    async def _feed_sentinel() -> None:
        """Wait for stream registration, then send sentinel to end it."""
        q = await _wait_for_queue(session_id)
        await q.put(None)

    feed_task = asyncio.create_task(_feed_sentinel())
    response = await client.get(f"/api/sessions/{session_id}/stream")
    await feed_task

    events = _parse_sse_events(response.text)

    # Should have: message (user), message (assistant), ready
    msg_events = [(t, d) for t, d in events if t == "message"]
    ready_events = [t for t, _ in events if t == "ready"]

    assert len(msg_events) == 2

    msg_0 = MessageEvent.model_validate_json(msg_events[0][1])
    assert msg_0.role == "user"
    assert msg_0.content == "Hello"

    msg_1 = MessageEvent.model_validate_json(msg_events[1][1])
    assert msg_1.role == "assistant"
    assert msg_1.content == "Hi there!"

    assert len(ready_events) == 1


@pytest.mark.asyncio
async def test_stream_returns_401_without_cookie(
    client: httpx.AsyncClient,
) -> None:
    """GET /stream without auth cookie should return 401."""
    response = await client.get("/api/sessions/some-id/stream")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_stream_returns_404_for_invalid_session(
    client: httpx.AsyncClient,
) -> None:
    """GET /stream with non-existent session should return 404."""
    client.cookies.set("gh_token", "gho_fake")
    response = await client.get("/api/sessions/nonexistent/stream")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_stream_processes_message_and_streams_response(
    client: httpx.AsyncClient,
) -> None:
    """Full flow: GET /stream → push message → get text-delta + done."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    chunks = [
        _make_chunk(content="Hello", model="gpt-4o"),
        _make_chunk(content=" world", model="gpt-4o", finish_reason="stop"),
    ]
    mock_create = AsyncMock(return_value=_mock_stream(chunks))

    with patch(AGENT_OPENAI_PATCH) as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = mock_create
        mock_openai_cls.return_value = mock_client

        async def _feed_message() -> None:
            q = await _wait_for_queue(session_id)
            await q.put({
                "content": "Hi",
                "model": "gpt-4o",
                "gh_token": "gho_fake",
            })
            # Wait for processing then send sentinel
            await asyncio.sleep(0.2)
            await q.put(None)

        feed_task = asyncio.create_task(_feed_message())
        response = await client.get(f"/api/sessions/{session_id}/stream")
        await feed_task

    events = _parse_sse_events(response.text)

    # Should have: ready, message (user echo), text-delta x2, done
    ready_events = [t for t, _ in events if t == "ready"]
    msg_events = [(t, d) for t, d in events if t == "message"]
    text_deltas = [(t, d) for t, d in events if t == "text-delta"]
    done_events = [(t, d) for t, d in events if t == "done"]

    assert len(ready_events) == 1
    assert len(msg_events) == 1

    user_msg = MessageEvent.model_validate_json(msg_events[0][1])
    assert user_msg.role == "user"
    assert user_msg.content == "Hi"

    assert len(text_deltas) == 2
    delta_0 = TextDeltaEvent.model_validate_json(text_deltas[0][1])
    assert delta_0.content == "Hello"
    delta_1 = TextDeltaEvent.model_validate_json(text_deltas[1][1])
    assert delta_1.content == " world"

    assert len(done_events) == 1
    done = DoneEvent.model_validate_json(done_events[0][1])
    assert done.model == "gpt-4o"


@pytest.mark.asyncio
async def test_stream_persists_messages(client: httpx.AsyncClient) -> None:
    """Messages sent through the stream should be persisted in the DB."""
    from voxpilot.services.sessions import get_messages

    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    chunks = [_make_chunk(content="Hey!", model="gpt-4o", finish_reason="stop")]
    mock_create = AsyncMock(return_value=_mock_stream(chunks))

    with patch(AGENT_OPENAI_PATCH) as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = mock_create
        mock_openai_cls.return_value = mock_client

        async def _feed() -> None:
            q = await _wait_for_queue(session_id)
            await q.put({
                "content": "Hello",
                "model": "gpt-4o",
                "gh_token": "gho_fake",
            })
            await asyncio.sleep(0.2)
            await q.put(None)

        feed_task = asyncio.create_task(_feed())
        await client.get(f"/api/sessions/{session_id}/stream")
        await feed_task

    db = get_db()
    messages = await get_messages(db, session_id)
    assert len(messages) == 2
    assert messages[0].role == "user"
    assert messages[0].content == "Hello"
    assert messages[1].role == "assistant"
    assert messages[1].content == "Hey!"


@pytest.mark.asyncio
async def test_stream_auto_titles_session(client: httpx.AsyncClient) -> None:
    """First message through the stream should auto-title the session."""
    from voxpilot.services.sessions import get_session

    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    chunks = [_make_chunk(content="Reply", model="gpt-4o", finish_reason="stop")]
    mock_create = AsyncMock(return_value=_mock_stream(chunks))

    with patch(AGENT_OPENAI_PATCH) as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = mock_create
        mock_openai_cls.return_value = mock_client

        async def _feed() -> None:
            q = await _wait_for_queue(session_id)
            await q.put({
                "content": "Tell me about cats",
                "model": "gpt-4o",
                "gh_token": "gho_fake",
            })
            await asyncio.sleep(0.2)
            await q.put(None)

        feed_task = asyncio.create_task(_feed())
        await client.get(f"/api/sessions/{session_id}/stream")
        await feed_task

    db = get_db()
    session = await get_session(db, session_id)
    assert session is not None
    assert session.title == "Tell me about cats"


@pytest.mark.asyncio
async def test_stream_error_on_openai_failure(
    client: httpx.AsyncClient,
) -> None:
    """OpenAI error during streaming should yield an error event."""
    from openai import OpenAIError

    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    mock_create = AsyncMock(side_effect=OpenAIError("rate limit exceeded"))

    with patch(AGENT_OPENAI_PATCH) as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = mock_create
        mock_openai_cls.return_value = mock_client

        async def _feed() -> None:
            q = await _wait_for_queue(session_id)
            await q.put({
                "content": "Hi",
                "model": "gpt-4o",
                "gh_token": "gho_fake",
            })
            await asyncio.sleep(0.2)
            await q.put(None)

        feed_task = asyncio.create_task(_feed())
        response = await client.get(f"/api/sessions/{session_id}/stream")
        await feed_task

    events = _parse_sse_events(response.text)
    error_events = [(t, d) for t, d in events if t == "error"]
    assert len(error_events) == 1

    err = ErrorEvent.model_validate_json(error_events[0][1])
    assert "rate limit" in err.message.lower()


@pytest.mark.asyncio
async def test_stream_unregisters_on_exit(client: httpx.AsyncClient) -> None:
    """Stream should unregister from the registry when it finishes."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    async def _feed_sentinel() -> None:
        q = await _wait_for_queue(session_id)
        await q.put(None)

    feed_task = asyncio.create_task(_feed_sentinel())
    await client.get(f"/api/sessions/{session_id}/stream")
    await feed_task

    assert registry.get(session_id) is None
