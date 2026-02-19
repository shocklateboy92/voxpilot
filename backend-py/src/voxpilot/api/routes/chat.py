"""Session-scoped SSE stream and message submission endpoints.

GET  /api/sessions/{session_id}/stream   — persistent EventSource stream
POST /api/sessions/{session_id}/messages — fire-and-forget message submission
POST /api/sessions/{session_id}/confirm  — approve or deny a tool call
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, Response, status
from sse_starlette.event import ServerSentEvent
from sse_starlette.sse import EventSourceResponse

from voxpilot.dependencies import DbDep, GitHubToken, SettingsDep
from voxpilot.models.schemas import (
    MessageEvent,
    SendMessageRequest,
    ToolConfirmRequest,
)
from voxpilot.services.agent import run_agent_loop
from voxpilot.services.sessions import (
    add_message,
    auto_title_if_needed,
    get_messages,
    get_messages_with_timestamps,
    session_exists,
)
from voxpilot.services.streams import registry

logger = logging.getLogger(__name__)

CONFIRM_TIMEOUT_SECONDS = 300  # 5 minutes

router = APIRouter(prefix="/api/sessions", tags=["chat"])


@router.get("/{session_id}/stream")
async def stream_session(
    session_id: str, token: GitHubToken, db: DbDep, request: Request, settings: SettingsDep
) -> EventSourceResponse:
    """Open a persistent SSE stream for a session.

    On connect the stream replays all existing messages as ``message``
    events, then sends a ``ready`` event.  After that, incoming user
    messages (posted via ``POST /{session_id}/messages``) are echoed as
    ``message`` events and the agent loop handles LLM + tool calls,
    streaming events as ``text-delta``, ``tool-call``, ``tool-result``,
    ``done``, or ``error``.

    SSE event types:
        message      — ``{"role": "...", "content": "...", "created_at": "...", ...}``
        ready        — ``{}``
        text-delta   — ``{"content": "..."}``
        tool-call    — ``{"id": "...", "name": "...", "arguments": "..."}``
        tool-confirm — ``{"id": "...", "name": "...", "arguments": "..."}``
        tool-result  — ``{"id": "...", "name": "...", "content": "...", "is_error": ...}``
        done         — ``{"model": "..."}``
        error        — ``{"message": "..."}``
    """
    if not await session_exists(db, session_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )

    queue = registry.register(session_id)
    confirm_queue = registry.register_confirm(session_id)

    async def _request_confirmation(
        call_id: str, name: str, arguments: str
    ) -> bool:
        """Wait for user to approve or deny a tool call."""
        registry.set_pending_confirm(session_id, call_id)
        try:
            return await asyncio.wait_for(
                confirm_queue.get(), timeout=CONFIRM_TIMEOUT_SECONDS
            )
        except TimeoutError:
            logger.warning(
                "Confirmation timeout for tool call %s in session %s",
                call_id,
                session_id,
            )
            return False

    async def _generate() -> AsyncIterator[ServerSentEvent]:
        try:
            # ── Replay history ────────────────────────────────────────
            history = await get_messages_with_timestamps(db, session_id)
            for msg in history:
                yield ServerSentEvent(
                    data=msg.model_dump_json(),
                    event="message",
                )

            yield ServerSentEvent(data="{}", event="ready")

            # ── Live loop ─────────────────────────────────────────────
            while True:
                # Wait for a message from the POST endpoint
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=30.0)
                except TimeoutError:
                    # Send keepalive comment to prevent connection timeout
                    yield ServerSentEvent(comment="keepalive")
                    continue

                # Sentinel — clean shutdown (used by tests)
                if payload is None:
                    break

                content: str = payload["content"]
                model: str = payload["model"]
                gh_token: str = payload["gh_token"]

                # Persist user message and auto-title
                await add_message(db, session_id, "user", content)
                await auto_title_if_needed(db, session_id, content)

                # Echo user message back to the stream
                now = datetime.now(UTC).isoformat()
                yield ServerSentEvent(
                    data=MessageEvent(
                        role="user", content=content, created_at=now
                    ).model_dump_json(),
                    event="message",
                )

                # Load full conversation for the agent loop
                messages = await get_messages(db, session_id)

                async for event in run_agent_loop(
                    messages=messages,
                    model=model,
                    gh_token=gh_token,
                    work_dir=settings.work_dir,
                    db=db,
                    session_id=session_id,
                    max_iterations=settings.max_agent_iterations,
                    is_disconnected=request.is_disconnected,
                    request_confirmation=_request_confirmation,
                ):
                    yield ServerSentEvent(
                        data=event["data"],
                        event=event["event"],
                    )
        finally:
            registry.unregister(session_id)
            registry.unregister_confirm(session_id)

    return EventSourceResponse(_generate())


@router.post(
    "/{session_id}/messages",
    status_code=status.HTTP_202_ACCEPTED,
)
async def send_message(
    session_id: str,
    body: SendMessageRequest,
    token: GitHubToken,
    db: DbDep,
) -> Response:
    """Submit a user message to an active session stream.

    The message is placed on the session's queue for processing by the
    SSE generator.  Returns **202 Accepted** immediately.  If no stream
    is connected, returns **409 Conflict**.
    """
    if not await session_exists(db, session_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )

    sent = await registry.send(
        session_id,
        {"content": body.content, "model": body.model, "gh_token": token},
    )
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No active stream for this session",
        )

    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post(
    "/{session_id}/confirm",
    status_code=status.HTTP_202_ACCEPTED,
)
async def confirm_tool(
    session_id: str,
    body: ToolConfirmRequest,
    token: GitHubToken,
    db: DbDep,
) -> Response:
    """Approve or deny a pending tool call that requires confirmation.

    Returns **202 Accepted** on success.  Returns **409 Conflict** if
    no confirmation is pending, the ``tool_call_id`` doesn't match, or
    no stream is connected.
    """
    if not await session_exists(db, session_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )

    ok = registry.put_confirm(session_id, body.tool_call_id, body.approved)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No pending confirmation for this tool call",
        )

    return Response(status_code=status.HTTP_202_ACCEPTED)
