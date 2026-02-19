"""In-memory stream registry bridging message POST and SSE stream endpoints."""

import asyncio
from typing import Any


class SessionStreamRegistry:
    """Manages per-session ``asyncio.Queue`` instances.

    The ``POST /{session_id}/messages`` endpoint puts payloads on the queue;
    the ``GET /{session_id}/stream`` SSE generator consumes them.

    Single connection per session — registering a new stream replaces any
    existing queue.
    """

    def __init__(self) -> None:
        self._queues: dict[str, asyncio.Queue[dict[str, Any] | None]] = {}
        self._confirm_queues: dict[str, asyncio.Queue[bool]] = {}
        self._pending_confirm: dict[str, str] = {}

    def register(self, session_id: str) -> asyncio.Queue[dict[str, Any] | None]:
        """Create and register a queue for *session_id*, returning it."""
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self._queues[session_id] = queue
        return queue

    def unregister(self, session_id: str) -> None:
        """Remove the queue for *session_id* (no-op if not registered)."""
        self._queues.pop(session_id, None)

    def get(self, session_id: str) -> asyncio.Queue[dict[str, Any] | None] | None:
        """Return the queue for *session_id*, or ``None`` if not registered."""
        return self._queues.get(session_id)

    async def send(self, session_id: str, payload: dict[str, Any] | None) -> bool:
        """Put *payload* on the session's queue.  Returns ``False`` if none."""
        queue = self._queues.get(session_id)
        if queue is None:
            return False
        await queue.put(payload)
        return True

    # ── Confirmation queue ────────────────────────────────────────────────────

    def register_confirm(self, session_id: str) -> asyncio.Queue[bool]:
        """Create a confirmation queue for *session_id*, returning it."""
        queue: asyncio.Queue[bool] = asyncio.Queue()
        self._confirm_queues[session_id] = queue
        self._pending_confirm.pop(session_id, None)
        return queue

    def unregister_confirm(self, session_id: str) -> None:
        """Remove the confirmation queue and pending state for *session_id*."""
        self._confirm_queues.pop(session_id, None)
        self._pending_confirm.pop(session_id, None)

    def set_pending_confirm(self, session_id: str, tool_call_id: str) -> None:
        """Record which tool call is awaiting user confirmation."""
        self._pending_confirm[session_id] = tool_call_id

    def put_confirm(
        self, session_id: str, tool_call_id: str, approved: bool
    ) -> bool:
        """Resolve a pending confirmation.

        Returns ``False`` if no confirmation queue exists or if
        *tool_call_id* doesn't match the pending ID (stale/mismatched).
        """
        queue = self._confirm_queues.get(session_id)
        if queue is None:
            return False
        pending = self._pending_confirm.get(session_id)
        if pending != tool_call_id:
            return False
        self._pending_confirm.pop(session_id, None)
        queue.put_nowait(approved)
        return True

    def get_confirm_queue(
        self, session_id: str
    ) -> asyncio.Queue[bool] | None:
        """Return the confirmation queue for *session_id*, or ``None``."""
        return self._confirm_queues.get(session_id)


registry = SessionStreamRegistry()
