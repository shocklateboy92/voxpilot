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


registry = SessionStreamRegistry()
