"""Shared pytest fixtures."""

from collections.abc import AsyncIterator

import httpx
import pytest

from voxpilot.main import app


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    """Provide an async HTTP client bound to the FastAPI app."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
