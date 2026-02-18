"""Session-scoped SSE stream and message submission endpoints.

GET  /api/sessions/{session_id}/stream   — persistent EventSource stream
POST /api/sessions/{session_id}/messages — fire-and-forget message submission
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, Response, status
from openai import AsyncOpenAI, OpenAIError
from openai.types.chat import (
    ChatCompletionAssistantMessageParam,
    ChatCompletionMessageParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
)
from sse_starlette.event import ServerSentEvent
from sse_starlette.sse import EventSourceResponse

from voxpilot.dependencies import DbDep, GitHubToken
from voxpilot.models.schemas import (
    ChatMessage,
    DoneEvent,
    ErrorEvent,
    MessageEvent,
    SendMessageRequest,
    TextDeltaEvent,
)
from voxpilot.services.sessions import (
    add_message,
    auto_title_if_needed,
    get_messages,
    get_messages_with_timestamps,
    session_exists,
)
from voxpilot.services.streams import registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["chat"])

GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com"


def _to_message_param(m: ChatMessage) -> ChatCompletionMessageParam:
    """Convert a ChatMessage schema to an OpenAI message param."""
    if m.role == "system":
        return ChatCompletionSystemMessageParam(role="system", content=m.content)
    if m.role == "assistant":
        return ChatCompletionAssistantMessageParam(role="assistant", content=m.content)
    return ChatCompletionUserMessageParam(role="user", content=m.content)


@router.get("/{session_id}/stream")
async def stream_session(
    session_id: str, token: GitHubToken, db: DbDep, request: Request
) -> EventSourceResponse:
    """Open a persistent SSE stream for a session.

    On connect the stream replays all existing messages as ``message``
    events, then sends a ``ready`` event.  After that, incoming user
    messages (posted via ``POST /{session_id}/messages``) are echoed as
    ``message`` events and the LLM response is streamed as
    ``text-delta`` / ``done`` / ``error`` events.

    SSE event types:
        message     — ``{"role": "...", "content": "...", "created_at": "..."}``
        ready       — ``{}``
        text-delta  — ``{"content": "..."}``
        done        — ``{"model": "..."}``
        error       — ``{"message": "..."}``
    """
    if not await session_exists(db, session_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )

    queue = registry.register(session_id)

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

                # Load full conversation for the LLM
                messages = await get_messages(db, session_id)
                openai_messages = [_to_message_param(m) for m in messages]

                client = AsyncOpenAI(
                    base_url=GITHUB_MODELS_BASE_URL,
                    api_key=gh_token,
                )

                model_name = model
                accumulated = ""
                try:
                    llm_stream = await client.chat.completions.create(
                        model=model,
                        messages=openai_messages,
                        stream=True,
                    )
                    async for chunk in llm_stream:
                        if await request.is_disconnected():
                            break

                        choice = chunk.choices[0] if chunk.choices else None
                        if choice and choice.delta.content:
                            accumulated += choice.delta.content
                            yield ServerSentEvent(
                                data=TextDeltaEvent(
                                    content=choice.delta.content
                                ).model_dump_json(),
                                event="text-delta",
                            )
                        if chunk.model:
                            model_name = chunk.model

                    # Persist complete assistant response
                    if accumulated:
                        await add_message(
                            db, session_id, "assistant", accumulated
                        )

                    yield ServerSentEvent(
                        data=DoneEvent(model=model_name).model_dump_json(),
                        event="done",
                    )
                except OpenAIError as exc:
                    logger.exception("OpenAI API error during streaming")
                    if accumulated:
                        await add_message(
                            db, session_id, "assistant", accumulated
                        )
                    yield ServerSentEvent(
                        data=ErrorEvent(message=str(exc)).model_dump_json(),
                        event="error",
                    )
                except Exception as exc:
                    logger.exception("Unexpected error during streaming")
                    if accumulated:
                        await add_message(
                            db, session_id, "assistant", accumulated
                        )
                    yield ServerSentEvent(
                        data=ErrorEvent(message=str(exc)).model_dump_json(),
                        event="error",
                    )
        finally:
            registry.unregister(session_id)

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
