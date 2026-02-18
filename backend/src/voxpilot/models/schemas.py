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


# ── Tool call data ────────────────────────────────────────────────────────────


class ToolCallInfo(BaseModel):
    """A single tool call within an assistant message."""

    id: str
    name: str
    arguments: str  # JSON-encoded arguments string


class ChatMessage(BaseModel):
    """A single message in a chat conversation."""

    role: Literal["user", "assistant", "system", "tool"]
    content: str
    tool_calls: list[ToolCallInfo] | None = None
    tool_call_id: str | None = None


class SendMessageRequest(BaseModel):
    """Request body for posting a user message to a session stream."""

    content: str
    model: str = "gpt-4o"


# ── SSE event payloads ────────────────────────────────────────────────────────
# Each model maps to one SSE event type.  The event name goes in the SSE
# `event:` field; the JSON-serialised model goes in `data:`.


class MessageEvent(BaseModel):
    """A persisted chat message (event: message).

    Used for history replay on connect and echoing new user messages.
    """

    role: Literal["user", "assistant", "system", "tool"]
    content: str
    created_at: str
    tool_calls: list[ToolCallInfo] | None = None
    tool_call_id: str | None = None


class ToolCallEvent(BaseModel):
    """A tool call requested by the assistant (event: tool-call)."""

    id: str
    name: str
    arguments: str  # JSON-encoded arguments string


class ToolResultEvent(BaseModel):
    """Result of a tool execution (event: tool-result)."""

    id: str
    name: str
    content: str
    is_error: bool = False


class TextDeltaEvent(BaseModel):
    """A single streamed token chunk (event: text-delta)."""

    content: str


class DoneEvent(BaseModel):
    """Signals the stream is complete (event: done)."""

    model: str


class ErrorEvent(BaseModel):
    """Signals an error during streaming (event: error)."""

    message: str


# ── Session schemas ───────────────────────────────────────────────────────────


class MessageRead(BaseModel):
    """A message as returned from the API (excludes DB-internal fields)."""

    role: Literal["user", "assistant", "system", "tool"]
    content: str
    created_at: str
    tool_calls: list[ToolCallInfo] | None = None
    tool_call_id: str | None = None


class SessionSummary(BaseModel):
    """Session metadata for list views."""

    id: str
    title: str
    created_at: str
    updated_at: str


class SessionDetail(BaseModel):
    """Full session with its message history."""

    id: str
    title: str
    messages: list[MessageRead]
    created_at: str
    updated_at: str


class SessionUpdate(BaseModel):
    """Request body for updating a session."""

    title: str
