"""Shared pytest fixtures."""

from collections.abc import AsyncIterator

import httpx
import pytest

from voxpilot.db import close_db, init_db
from voxpilot.main import app


@pytest.fixture(autouse=True)
async def _init_test_db() -> AsyncIterator[None]:
    """Initialise an in-memory SQLite database for every test."""
    await init_db(":memory:")
    yield
    await close_db()


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    """Provide an async HTTP client bound to the FastAPI app."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
