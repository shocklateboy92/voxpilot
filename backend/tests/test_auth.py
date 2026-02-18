"""Tests for authentication routes."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from voxpilot.models.schemas import GitHubUser


@pytest.mark.asyncio
async def test_login_redirects_to_github(client: httpx.AsyncClient) -> None:
    """GET /api/auth/login should redirect to GitHub OAuth."""
    response = await client.get("/api/auth/login", follow_redirects=False)
    assert response.status_code == 302
    location = response.headers["location"]
    assert "github.com/login/oauth/authorize" in location
    assert "client_id=" in location


@pytest.mark.asyncio
async def test_callback_sets_cookie_and_redirects(client: httpx.AsyncClient) -> None:
    """GET /api/auth/callback should exchange code, set cookie, redirect to /."""
    with patch(
        "voxpilot.api.routes.auth.exchange_code_for_token",
        new_callable=AsyncMock,
        return_value="gho_fake_token_123",
    ):
        response = await client.get(
            "/api/auth/callback?code=test_code&state=test_state",
            follow_redirects=False,
        )
        assert response.status_code == 302
        assert response.headers["location"] == "/"
        # Check that the gh_token cookie was set
        cookies = response.headers.get_list("set-cookie")
        token_cookie = [c for c in cookies if c.startswith("gh_token=")]
        assert len(token_cookie) == 1
        assert "gho_fake_token_123" in token_cookie[0]
        assert "httponly" in token_cookie[0].lower()


@pytest.mark.asyncio
async def test_me_returns_401_without_cookie(client: httpx.AsyncClient) -> None:
    """GET /api/auth/me should return 401 when not authenticated."""
    response = await client.get("/api/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_user_with_valid_cookie(client: httpx.AsyncClient) -> None:
    """GET /api/auth/me should return user info when cookie is present."""
    mock_user = GitHubUser(login="testuser", name="Test User", avatar_url="https://example.com/avatar.png")

    with patch(
        "voxpilot.api.routes.auth.get_github_user",
        new_callable=AsyncMock,
        return_value=mock_user,
    ):
        client.cookies.set("gh_token", "gho_fake_token_123")
        response = await client.get("/api/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["login"] == "testuser"
        assert data["name"] == "Test User"
        assert data["avatar_url"] == "https://example.com/avatar.png"


@pytest.mark.asyncio
async def test_logout_clears_cookie(client: httpx.AsyncClient) -> None:
    """POST /api/auth/logout should clear the gh_token cookie."""
    client.cookies.set("gh_token", "gho_fake_token_123")
    response = await client.post("/api/auth/logout")
    assert response.status_code == 200
    # The cookie should be cleared (max-age=0 or expired)
    cookies = response.headers.get_list("set-cookie")
    token_cookie = [c for c in cookies if "gh_token" in c]
    assert len(token_cookie) == 1
    # Cookie deletion sets max-age=0 or expires in the past
    assert '0' in token_cookie[0] or "01 Jan 1970" in token_cookie[0]
