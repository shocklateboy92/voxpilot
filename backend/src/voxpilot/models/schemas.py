"""Pydantic v2 response and request schemas."""

from typing import Literal

from pydantic import BaseModel


class StatusResponse(BaseModel):
    """Generic status response."""

    status: str


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    app_name: str


class GitHubUser(BaseModel):
    """GitHub user profile."""

    login: str
    name: str | None = None
    avatar_url: str


class ChatMessage(BaseModel):
    """A single message in a chat conversation."""

    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    """Request body for the chat endpoint."""

    messages: list[ChatMessage]
    model: str = "gpt-4o"


# ── SSE event payloads ────────────────────────────────────────────────────────
# Each model maps to one SSE event type.  The event name goes in the SSE
# `event:` field; the JSON-serialised model goes in `data:`.
#
# Future phases will add:
#   ToolCallEvent   (event: tool-call)   — {id, name, arguments}
#   ToolResultEvent (event: tool-result) — {id, content}


class TextDeltaEvent(BaseModel):
    """A single streamed token chunk (event: text-delta)."""

    content: str


class DoneEvent(BaseModel):
    """Signals the stream is complete (event: done)."""

    model: str


class ErrorEvent(BaseModel):
    """Signals an error during streaming (event: error)."""

    message: str
