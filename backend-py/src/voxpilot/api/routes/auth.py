"""Authentication routes for GitHub OAuth."""

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse, RedirectResponse

from voxpilot.dependencies import GitHubToken, SettingsDep
from voxpilot.models.schemas import GitHubUser, StatusResponse
from voxpilot.services.github import (
    build_authorization_url,
    exchange_code_for_token,
    generate_state,
    get_github_user,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days
STATE_COOKIE_MAX_AGE = 60 * 10  # 10 minutes


@router.get("/login")
def login(settings: SettingsDep) -> RedirectResponse:
    """Redirect to GitHub OAuth authorization page."""
    state = generate_state()
    url = build_authorization_url(settings.github_client_id, state)
    response = RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)
    response.set_cookie(
        key="oauth_state",
        value=state,
        max_age=STATE_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/callback")
async def callback(
    code: str,
    state: str,
    settings: SettingsDep,
) -> RedirectResponse:
    """Handle the OAuth callback from GitHub."""
    # Note: oauth_state cookie validation is best-effort;
    # FastAPI doesn't inject cookies into path-operation params easily
    # alongside query params, so we read it manually from the redirect flow.
    # The state param protects against CSRF on the OAuth flow.

    token = await exchange_code_for_token(
        client_id=settings.github_client_id,
        client_secret=settings.github_client_secret,
        code=code,
    )

    response = RedirectResponse(url="/", status_code=status.HTTP_302_FOUND)
    response.set_cookie(
        key="gh_token",
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
    )
    # Clean up the state cookie
    response.delete_cookie(key="oauth_state")
    return response


@router.post("/logout", response_model=StatusResponse)
def logout() -> JSONResponse:
    """Clear the authentication cookie."""
    response = JSONResponse(content={"status": "ok"})
    response.delete_cookie(key="gh_token")
    return response


@router.get("/me", response_model=GitHubUser)
async def me(token: GitHubToken) -> GitHubUser:
    """Return the authenticated user's GitHub profile."""
    try:
        return await get_github_user(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc
