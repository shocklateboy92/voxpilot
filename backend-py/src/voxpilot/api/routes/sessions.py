"""Session CRUD routes."""

from fastapi import APIRouter, HTTPException, Response, status

from voxpilot.dependencies import DbDep, GitHubToken
from voxpilot.models.schemas import SessionDetail, SessionSummary, SessionUpdate
from voxpilot.services.sessions import (
    create_session,
    delete_session,
    get_session,
    list_sessions,
    update_session_title,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("", response_model=list[SessionSummary])
async def list_all(
    _token: GitHubToken, db: DbDep
) -> list[SessionSummary]:
    """Return all sessions, most-recently updated first."""
    return await list_sessions(db)


@router.post("", response_model=SessionSummary, status_code=status.HTTP_201_CREATED)
async def create(
    _token: GitHubToken, db: DbDep
) -> SessionSummary:
    """Create a new empty session."""
    return await create_session(db)


@router.get("/{session_id}", response_model=SessionDetail)
async def get_one(
    session_id: str, _token: GitHubToken, db: DbDep
) -> SessionDetail:
    """Return a session with its full message history."""
    session = await get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(
    session_id: str, _token: GitHubToken, db: DbDep
) -> Response:
    """Delete a session and all its messages."""
    deleted = await delete_session(db, session_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{session_id}", response_model=SessionSummary)
async def update(
    session_id: str, body: SessionUpdate, _token: GitHubToken, db: DbDep
) -> SessionSummary:
    """Update a session's title."""
    session = await update_session_title(db, session_id, body.title)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session
