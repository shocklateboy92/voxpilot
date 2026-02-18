"""GitHub OAuth and API service."""

import secrets
from urllib.parse import urlencode

import httpx

from voxpilot.models.schemas import GitHubUser

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"  # noqa: S105
GITHUB_USER_URL = "https://api.github.com/user"


def generate_state() -> str:
    """Generate a random state parameter for OAuth CSRF protection."""
    return secrets.token_urlsafe(32)


def build_authorization_url(client_id: str, state: str) -> str:
    """Build the GitHub OAuth authorization URL."""
    params = {
        "client_id": client_id,
        "state": state,
    }
    return f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code_for_token(
    client_id: str,
    client_secret: str,
    code: str,
) -> str:
    """Exchange an authorization code for an access token."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            GITHUB_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
            },
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()
        data = response.json()
        token = data.get("access_token")
        if not token:
            error = data.get("error_description", "Unknown error")
            raise ValueError(f"GitHub OAuth error: {error}")
        return token


async def get_github_user(access_token: str) -> GitHubUser:
    """Fetch the authenticated user's profile from GitHub."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            GITHUB_USER_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
        )
        response.raise_for_status()
        data = response.json()
        return GitHubUser(
            login=str(data["login"]),
            name=str(data["name"]) if data.get("name") else None,
            avatar_url=str(data["avatar_url"]),
        )
