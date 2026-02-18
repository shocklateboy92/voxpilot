"""Chat completions route using GitHub Models API."""

from fastapi import APIRouter
from openai import AsyncOpenAI
from openai.types.chat import (
    ChatCompletionAssistantMessageParam,
    ChatCompletionMessageParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
)

from voxpilot.dependencies import GitHubToken
from voxpilot.models.schemas import ChatMessage, ChatRequest, ChatResponse

router = APIRouter(prefix="/api", tags=["chat"])

GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com"


def _to_message_param(m: ChatMessage) -> ChatCompletionMessageParam:
    """Convert a ChatMessage schema to an OpenAI message param."""
    if m.role == "system":
        return ChatCompletionSystemMessageParam(role="system", content=m.content)
    if m.role == "assistant":
        return ChatCompletionAssistantMessageParam(role="assistant", content=m.content)
    return ChatCompletionUserMessageParam(role="user", content=m.content)


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, token: GitHubToken) -> ChatResponse:
    """Send a chat completion request to GitHub Models API."""
    client = AsyncOpenAI(
        base_url=GITHUB_MODELS_BASE_URL,
        api_key=token,
    )

    messages = [_to_message_param(m) for m in request.messages]

    completion = await client.chat.completions.create(
        model=request.model,
        messages=messages,
    )

    content = completion.choices[0].message.content or ""
    model = completion.model or request.model

    return ChatResponse(message=content, model=model)
