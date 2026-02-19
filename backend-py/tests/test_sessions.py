"""Tests for session CRUD routes."""

import httpx
import pytest


@pytest.mark.asyncio
async def test_list_sessions_empty(client: httpx.AsyncClient) -> None:
    """GET /api/sessions should return an empty list initially."""
    client.cookies.set("gh_token", "gho_fake")
    response = await client.get("/api/sessions")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_create_session(client: httpx.AsyncClient) -> None:
    """POST /api/sessions should create a session with an empty title."""
    client.cookies.set("gh_token", "gho_fake")
    response = await client.post("/api/sessions")
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    assert data["title"] == ""
    assert "created_at" in data
    assert "updated_at" in data


@pytest.mark.asyncio
async def test_list_sessions_returns_created(client: httpx.AsyncClient) -> None:
    """After creating sessions, GET /api/sessions should return them."""
    client.cookies.set("gh_token", "gho_fake")
    await client.post("/api/sessions")
    await client.post("/api/sessions")

    response = await client.get("/api/sessions")
    assert response.status_code == 200
    sessions = response.json()
    assert len(sessions) == 2


@pytest.mark.asyncio
async def test_get_session_with_messages(client: httpx.AsyncClient) -> None:
    """GET /api/sessions/{id} should return session with empty messages."""
    client.cookies.set("gh_token", "gho_fake")
    create_resp = await client.post("/api/sessions")
    session_id = create_resp.json()["id"]

    response = await client.get(f"/api/sessions/{session_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == session_id
    assert data["messages"] == []


@pytest.mark.asyncio
async def test_get_session_not_found(client: httpx.AsyncClient) -> None:
    """GET /api/sessions/{id} should return 404 for unknown id."""
    client.cookies.set("gh_token", "gho_fake")
    response = await client.get("/api/sessions/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_session(client: httpx.AsyncClient) -> None:
    """DELETE /api/sessions/{id} should remove the session."""
    client.cookies.set("gh_token", "gho_fake")
    create_resp = await client.post("/api/sessions")
    session_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/sessions/{session_id}")
    assert delete_resp.status_code == 204

    # Verify it's gone
    get_resp = await client.get(f"/api/sessions/{session_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_session_not_found(client: httpx.AsyncClient) -> None:
    """DELETE /api/sessions/{id} should return 404 for unknown id."""
    client.cookies.set("gh_token", "gho_fake")
    response = await client.delete("/api/sessions/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_session_title(client: httpx.AsyncClient) -> None:
    """PATCH /api/sessions/{id} should update the title."""
    client.cookies.set("gh_token", "gho_fake")
    create_resp = await client.post("/api/sessions")
    session_id = create_resp.json()["id"]

    patch_resp = await client.patch(
        f"/api/sessions/{session_id}",
        json={"title": "My chat"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["title"] == "My chat"

    # Verify via GET
    get_resp = await client.get(f"/api/sessions/{session_id}")
    assert get_resp.json()["title"] == "My chat"


@pytest.mark.asyncio
async def test_update_session_not_found(client: httpx.AsyncClient) -> None:
    """PATCH /api/sessions/{id} should return 404 for unknown id."""
    client.cookies.set("gh_token", "gho_fake")
    response = await client.patch(
        "/api/sessions/nonexistent-id",
        json={"title": "Nope"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_sessions_require_auth(client: httpx.AsyncClient) -> None:
    """Session endpoints should return 401 without a token."""
    assert (await client.get("/api/sessions")).status_code == 401
    assert (await client.post("/api/sessions")).status_code == 401
    assert (await client.get("/api/sessions/some-id")).status_code == 401
    assert (await client.delete("/api/sessions/some-id")).status_code == 401
    assert (
        await client.patch("/api/sessions/some-id", json={"title": "x"})
    ).status_code == 401


@pytest.mark.asyncio
async def test_cascade_delete_removes_messages(client: httpx.AsyncClient) -> None:
    """Deleting a session should also remove its messages (ON DELETE CASCADE)."""
    client.cookies.set("gh_token", "gho_fake")

    # Create session and add a message via the service layer directly
    from voxpilot.db import get_db
    from voxpilot.services.sessions import add_message, create_session, get_messages

    db = get_db()
    session = await create_session(db)
    await add_message(db, session.id, "user", "hello")
    messages = await get_messages(db, session.id)
    assert len(messages) == 1

    # Delete session
    delete_resp = await client.delete(f"/api/sessions/{session.id}")
    assert delete_resp.status_code == 204

    # Verify messages are gone (query the DB directly)
    cursor = await db.execute(
        "SELECT COUNT(*) FROM messages WHERE session_id = ?", (session.id,)
    )
    row = await cursor.fetchone()
    assert row is not None
    assert row[0] == 0
