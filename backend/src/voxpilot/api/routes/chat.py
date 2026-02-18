"""Chat completions route using GitHub Models API with SSE streaming."""

import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request, status
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
    ChatRequest,
    DoneEvent,
    ErrorEvent,
    TextDeltaEvent,
)
from voxpilot.services.sessions import (
    add_message,
    auto_title_if_needed,
    get_messages,
    session_exists,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])

GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com"


def _to_message_param(m: ChatMessage) -> ChatCompletionMessageParam:
    """Convert a ChatMessage schema to an OpenAI message param."""
    if m.role == "system":
        return ChatCompletionSystemMessageParam(role="system", content=m.content)
    if m.role == "assistant":
        return ChatCompletionAssistantMessageParam(role="assistant", content=m.content)
    return ChatCompletionUserMessageParam(role="user", content=m.content)


@router.post("/chat")
async def chat(
    body: ChatRequest, token: GitHubToken, db: DbDep, request: Request
) -> EventSourceResponse:
    """Stream a chat completion response as Server-Sent Events.

    The user message is persisted before streaming.  The assistant response
    is accumulated and persisted when the stream completes.

    SSE event types:
        text-delta  — ``{"content": "..."}``  (one per token)
        done        — ``{"model": "..."}``    (final event)
        error       — ``{"message": "..."}``  (on failure)
    """
    # Validate session
    if not await session_exists(db, body.session_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )

    # Persist user message and auto-title the session
    await add_message(db, body.session_id, "user", body.content)
    await auto_title_if_needed(db, body.session_id, body.content)

    # Load full conversation history for the LLM
    history = await get_messages(db, body.session_id)

    client = AsyncOpenAI(
        base_url=GITHUB_MODELS_BASE_URL,
        api_key=token,
    )
    messages = [_to_message_param(m) for m in history]

    async def _generate() -> AsyncIterator[ServerSentEvent]:
        model_name = body.model
        accumulated = ""
        try:
            stream = await client.chat.completions.create(
                model=body.model,
                messages=messages,
                stream=True,
            )
            async for chunk in stream:
                # Check for client disconnect
                if await request.is_disconnected():
                    break

                choice = chunk.choices[0] if chunk.choices else None
                if choice and choice.delta.content:
                    accumulated += choice.delta.content
                    yield ServerSentEvent(
                        data=TextDeltaEvent(content=choice.delta.content).model_dump_json(),
                        event="text-delta",
                    )
                # Capture model name from first chunk that has it
                if chunk.model:
                    model_name = chunk.model

            # Persist the complete assistant response
            if accumulated:
                await add_message(db, body.session_id, "assistant", accumulated)

            yield ServerSentEvent(
                data=DoneEvent(model=model_name).model_dump_json(),
                event="done",
            )
        except OpenAIError as exc:
            logger.exception("OpenAI API error during streaming")
            # Persist partial response if any
            if accumulated:
                await add_message(db, body.session_id, "assistant", accumulated)
            yield ServerSentEvent(
                data=ErrorEvent(message=str(exc)).model_dump_json(),
                event="error",
            )
        except Exception as exc:
            logger.exception("Unexpected error during streaming")
            if accumulated:
                await add_message(db, body.session_id, "assistant", accumulated)
            yield ServerSentEvent(
                data=ErrorEvent(message=str(exc)).model_dump_json(),
                event="error",
            )

    return EventSourceResponse(_generate())
