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


class ChatResponse(BaseModel):
    """Response from the chat endpoint."""

    message: str
    model: str
