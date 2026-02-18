"""Chat completions route using GitHub Models API with SSE streaming."""

import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from openai import AsyncOpenAI, OpenAIError
from openai.types.chat import (
    ChatCompletionAssistantMessageParam,
    ChatCompletionMessageParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
)
from sse_starlette.event import ServerSentEvent
from sse_starlette.sse import EventSourceResponse

from voxpilot.dependencies import GitHubToken
from voxpilot.models.schemas import (
    ChatMessage,
    ChatRequest,
    DoneEvent,
    ErrorEvent,
    TextDeltaEvent,
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
    body: ChatRequest, token: GitHubToken, request: Request
) -> EventSourceResponse:
    """Stream a chat completion response as Server-Sent Events.

    SSE event types:
        text-delta  — ``{"content": "..."}``  (one per token)
        done        — ``{"model": "..."}``    (final event)
        error       — ``{"message": "..."}``  (on failure)
    """
    client = AsyncOpenAI(
        base_url=GITHUB_MODELS_BASE_URL,
        api_key=token,
    )
    messages = [_to_message_param(m) for m in body.messages]

    async def _generate() -> AsyncIterator[ServerSentEvent]:
        model_name = body.model
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
                    yield ServerSentEvent(
                        data=TextDeltaEvent(content=choice.delta.content).model_dump_json(),
                        event="text-delta",
                    )
                # Capture model name from first chunk that has it
                if chunk.model:
                    model_name = chunk.model

            yield ServerSentEvent(
                data=DoneEvent(model=model_name).model_dump_json(),
                event="done",
            )
        except OpenAIError as exc:
            logger.exception("OpenAI API error during streaming")
            yield ServerSentEvent(
                data=ErrorEvent(message=str(exc)).model_dump_json(),
                event="error",
            )
        except Exception as exc:
            logger.exception("Unexpected error during streaming")
            yield ServerSentEvent(
                data=ErrorEvent(message=str(exc)).model_dump_json(),
                event="error",
            )

    return EventSourceResponse(_generate())
