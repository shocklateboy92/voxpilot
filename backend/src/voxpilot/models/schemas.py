"""Pydantic v2 response and request schemas."""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    app_name: str
