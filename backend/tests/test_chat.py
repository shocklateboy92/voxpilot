"""Tests for the streaming chat endpoint."""

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from voxpilot.models.schemas import DoneEvent, ErrorEvent, TextDeltaEvent


def _make_chunk(
    content: str | None = None, model: str | None = None
) -> MagicMock:
    """Create a mock ChatCompletionChunk."""
    chunk = MagicMock()
    choice = MagicMock()
    choice.delta.content = content
    chunk.choices = [choice] if content is not None else []
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
    # Normalize \r\n to \n for consistent parsing
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.startswith("event:"):
            event_type = line[len("event:"):].strip()
        elif line.startswith("data:"):
            data = line[len("data:"):].strip()
        elif line == "" and event_type and data:
            events.append((event_type, data))
            event_type = ""
            data = ""
    # Handle final event if no trailing blank line
    if event_type and data:
        events.append((event_type, data))
    return events


@pytest.mark.asyncio
async def test_chat_streams_text_deltas(client: httpx.AsyncClient) -> None:
    """POST /api/chat should stream text-delta events followed by done."""
    chunks = [
        _make_chunk(content="Hello", model="gpt-4o"),
        _make_chunk(content=" world", model="gpt-4o"),
    ]

    mock_create = AsyncMock(return_value=_mock_stream(chunks))

    with patch("voxpilot.api.routes.chat.AsyncOpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = mock_create
        mock_openai_cls.return_value = mock_client

        client.cookies.set("gh_token", "gho_fake_token_123")
        response = await client.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "Hi"}], "model": "gpt-4o"},
        )

    assert response.status_code == 200
    assert "text/event-stream" in response.headers.get("content-type", "")

    events = _parse_sse_events(response.text)

    # Should have 2 text-delta events + 1 done event
    text_deltas = [(t, d) for t, d in events if t == "text-delta"]
    done_events = [(t, d) for t, d in events if t == "done"]

    assert len(text_deltas) == 2

    delta_0 = TextDeltaEvent.model_validate_json(text_deltas[0][1])
    assert delta_0.content == "Hello"

    delta_1 = TextDeltaEvent.model_validate_json(text_deltas[1][1])
    assert delta_1.content == " world"

    assert len(done_events) == 1
    done = DoneEvent.model_validate_json(done_events[0][1])
    assert done.model == "gpt-4o"


@pytest.mark.asyncio
async def test_chat_streams_error_on_openai_failure(client: httpx.AsyncClient) -> None:
    """POST /api/chat should yield an error event if OpenAI raises."""
    from openai import OpenAIError

    mock_create = AsyncMock(side_effect=OpenAIError("rate limit exceeded"))

    with patch("voxpilot.api.routes.chat.AsyncOpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = mock_create
        mock_openai_cls.return_value = mock_client

        client.cookies.set("gh_token", "gho_fake_token_123")
        response = await client.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "Hi"}], "model": "gpt-4o"},
        )

    assert response.status_code == 200

    events = _parse_sse_events(response.text)
    error_events = [(t, d) for t, d in events if t == "error"]
    assert len(error_events) == 1

    err = ErrorEvent.model_validate_json(error_events[0][1])
    assert "rate limit" in err.message.lower()


@pytest.mark.asyncio
async def test_chat_returns_401_without_cookie(client: httpx.AsyncClient) -> None:
    """POST /api/chat without auth cookie should return 401."""
    response = await client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "Hi"}], "model": "gpt-4o"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_chat_empty_response(client: httpx.AsyncClient) -> None:
    """POST /api/chat with model returning no content should still send done."""
    chunks = [_make_chunk(content=None, model="gpt-4o")]

    mock_create = AsyncMock(return_value=_mock_stream(chunks))

    with patch("voxpilot.api.routes.chat.AsyncOpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = mock_create
        mock_openai_cls.return_value = mock_client

        client.cookies.set("gh_token", "gho_fake_token_123")
        response = await client.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "Hi"}], "model": "gpt-4o"},
        )

    events = _parse_sse_events(response.text)
    text_deltas = [t for t, _ in events if t == "text-delta"]
    done_events = [t for t, _ in events if t == "done"]

    assert len(text_deltas) == 0
    assert len(done_events) == 1
