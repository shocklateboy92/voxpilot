"""Shared FastAPI dependencies."""

from functools import lru_cache
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, status

from voxpilot.config import Settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()


SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_github_token(gh_token: Annotated[str | None, Cookie()] = None) -> str:
    """Extract the GitHub access token from the cookie, or raise 401."""
    if not gh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return gh_token


GitHubToken = Annotated[str, Depends(get_github_token)]
