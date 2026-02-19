"""Tests for the user confirmation / approval mechanism."""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from voxpilot.db import get_db
from voxpilot.models.schemas import ToolConfirmEvent, ToolResultEvent
from voxpilot.services.sessions import create_session
from voxpilot.services.streams import SessionStreamRegistry, registry

AGENT_OPENAI_PATCH = "voxpilot.services.agent.AsyncOpenAI"


# ── Helpers (same patterns as test_agent.py) ──────────────────────────────────


def _make_text_chunk(
    content: str | None = None,
    model: str | None = None,
    finish_reason: str | None = None,
) -> MagicMock:
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
    for chunk in chunks:
        yield chunk


def _parse_sse_events(text: str) -> list[tuple[str, str]]:
    events: list[tuple[str, str]] = []
    event_type = ""
    data = ""
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.startswith("event:"):
            event_type = line[len("event:") :].strip()
        elif line.startswith("data:"):
            data = line[len("data:") :].strip()
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


# ── SessionStreamRegistry confirmation queue unit tests ───────────────────────


def test_confirm_queue_register_and_put() -> None:
    """Register a confirm queue, set pending, and resolve it."""
    reg = SessionStreamRegistry()
    queue = reg.register_confirm("s1")

    reg.set_pending_confirm("s1", "call_1")
    ok = reg.put_confirm("s1", "call_1", True)
    assert ok is True
    assert queue.get_nowait() is True


def test_confirm_queue_mismatched_id() -> None:
    """put_confirm should fail if tool_call_id doesn't match pending."""
    reg = SessionStreamRegistry()
    reg.register_confirm("s1")
    reg.set_pending_confirm("s1", "call_1")

    ok = reg.put_confirm("s1", "call_WRONG", True)
    assert ok is False


def test_confirm_queue_no_pending() -> None:
    """put_confirm should fail if nothing is pending."""
    reg = SessionStreamRegistry()
    reg.register_confirm("s1")

    ok = reg.put_confirm("s1", "call_1", True)
    assert ok is False


def test_confirm_queue_not_registered() -> None:
    """put_confirm should fail if session has no confirm queue."""
    reg = SessionStreamRegistry()
    ok = reg.put_confirm("s1", "call_1", True)
    assert ok is False


def test_confirm_queue_unregister() -> None:
    """Unregistering should clean up queue and pending state."""
    reg = SessionStreamRegistry()
    reg.register_confirm("s1")
    reg.set_pending_confirm("s1", "call_1")
    reg.unregister_confirm("s1")

    assert reg.get_confirm_queue("s1") is None
    ok = reg.put_confirm("s1", "call_1", True)
    assert ok is False


def test_confirm_queue_clears_pending_after_put() -> None:
    """After a successful put_confirm, re-putting the same ID should fail."""
    reg = SessionStreamRegistry()
    reg.register_confirm("s1")
    reg.set_pending_confirm("s1", "call_1")

    ok1 = reg.put_confirm("s1", "call_1", True)
    assert ok1 is True

    # Second put with same ID should fail (pending cleared)
    ok2 = reg.put_confirm("s1", "call_1", True)
    assert ok2 is False


# ── Integration: confirmation-required tool (approved) ────────────────────────


@pytest.mark.asyncio
async def test_confirm_tool_approved(client: httpx.AsyncClient) -> None:
    """Approved confirmation should let the tool execute normally."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    tool_call_chunks = [
        _make_tool_call_chunk(
            index=0,
            call_id="call_ext",
            name="read_file_external",
            arguments=json.dumps({"path": "/etc/hostname"}),
            finish_reason="tool_calls",
        ),
    ]
    text_chunks = [
        _make_text_chunk(content="Done.", model="gpt-4o", finish_reason="stop"),
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

        async def _feed_and_confirm() -> None:
            q = await _wait_for_queue(session_id)
            await q.put({
                "content": "Read /etc/hostname",
                "model": "gpt-4o",
                "gh_token": "gho_fake",
            })
            # Wait for the confirm queue to be armed
            for _ in range(200):
                cq = registry.get_confirm_queue(session_id)
                if cq is not None and session_id in registry._pending_confirm:
                    break
                await asyncio.sleep(0.01)
            # Approve the tool
            resp = await client.post(
                f"/api/sessions/{session_id}/confirm",
                json={"tool_call_id": "call_ext", "approved": True},
            )
            assert resp.status_code == 202
            await asyncio.sleep(0.3)
            await q.put(None)

        feed_task = asyncio.create_task(_feed_and_confirm())
        response = await client.get(f"/api/sessions/{session_id}/stream")
        await feed_task

    events = _parse_sse_events(response.text)
    event_types = [t for t, _ in events]

    assert "tool-confirm" in event_types
    assert "tool-result" in event_types
    assert "done" in event_types

    # tool-confirm payload
    tc_events = [(t, d) for t, d in events if t == "tool-confirm"]
    assert len(tc_events) == 1
    confirm = ToolConfirmEvent.model_validate_json(tc_events[0][1])
    assert confirm.id == "call_ext"
    assert confirm.name == "read_file_external"

    # tool-result should NOT be an error (was approved)
    tr_events = [(t, d) for t, d in events if t == "tool-result"]
    assert len(tr_events) == 1
    tr = ToolResultEvent.model_validate_json(tr_events[0][1])
    assert tr.is_error is False or "declined" not in tr.content


# ── Integration: confirmation-required tool (denied) ──────────────────────────


@pytest.mark.asyncio
async def test_confirm_tool_denied(client: httpx.AsyncClient) -> None:
    """Denied confirmation should produce an error result for the LLM."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    tool_call_chunks = [
        _make_tool_call_chunk(
            index=0,
            call_id="call_ext2",
            name="read_file_external",
            arguments=json.dumps({"path": "/etc/shadow"}),
            finish_reason="tool_calls",
        ),
    ]
    text_chunks = [
        _make_text_chunk(
            content="I can't read that file.",
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

        async def _feed_and_deny() -> None:
            q = await _wait_for_queue(session_id)
            await q.put({
                "content": "Read /etc/shadow",
                "model": "gpt-4o",
                "gh_token": "gho_fake",
            })
            for _ in range(200):
                cq = registry.get_confirm_queue(session_id)
                if cq is not None and session_id in registry._pending_confirm:
                    break
                await asyncio.sleep(0.01)
            resp = await client.post(
                f"/api/sessions/{session_id}/confirm",
                json={"tool_call_id": "call_ext2", "approved": False},
            )
            assert resp.status_code == 202
            await asyncio.sleep(0.3)
            await q.put(None)

        feed_task = asyncio.create_task(_feed_and_deny())
        response = await client.get(f"/api/sessions/{session_id}/stream")
        await feed_task

    events = _parse_sse_events(response.text)
    event_types = [t for t, _ in events]

    assert "tool-confirm" in event_types
    assert "tool-result" in event_types

    tr_events = [(t, d) for t, d in events if t == "tool-result"]
    assert len(tr_events) == 1
    tr = ToolResultEvent.model_validate_json(tr_events[0][1])
    assert tr.is_error is True
    assert "declined" in tr.content.lower()


# ── POST /confirm endpoint edge cases ────────────────────────────────────────


@pytest.mark.asyncio
async def test_confirm_endpoint_no_stream(client: httpx.AsyncClient) -> None:
    """POST /confirm should 409 when no stream is connected."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    resp = await client.post(
        f"/api/sessions/{session_id}/confirm",
        json={"tool_call_id": "call_xxx", "approved": True},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_confirm_endpoint_mismatched_id(client: httpx.AsyncClient) -> None:
    """POST /confirm should 409 when tool_call_id doesn't match pending."""
    session_id = await _create_test_session()
    client.cookies.set("gh_token", "gho_fake")

    # Manually set up a pending confirm
    registry.register_confirm(session_id)
    registry.set_pending_confirm(session_id, "call_real")
    try:
        resp = await client.post(
            f"/api/sessions/{session_id}/confirm",
            json={"tool_call_id": "call_WRONG", "approved": True},
        )
        assert resp.status_code == 409
    finally:
        registry.unregister_confirm(session_id)


@pytest.mark.asyncio
async def test_confirm_endpoint_nonexistent_session(client: httpx.AsyncClient) -> None:
    """POST /confirm should 404 for a nonexistent session."""
    client.cookies.set("gh_token", "gho_fake")
    resp = await client.post(
        "/api/sessions/nonexistent/confirm",
        json={"tool_call_id": "call_xxx", "approved": True},
    )
    assert resp.status_code == 404
