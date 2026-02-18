"""Session and message persistence backed by aiosqlite."""

import json
import uuid
from datetime import UTC, datetime

import aiosqlite

from voxpilot.models.schemas import (
    ChatMessage,
    MessageEvent,
    MessageRead,
    SessionDetail,
    SessionSummary,
    ToolCallInfo,
)


def _now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(UTC).isoformat()


def _row_to_summary(row: aiosqlite.Row) -> SessionSummary:
    return SessionSummary(
        id=row["id"],
        title=row["title"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_message_read(row: aiosqlite.Row) -> MessageRead:
    return MessageRead(
        role=row["role"],
        content=row["content"],
        created_at=row["created_at"],
        tool_calls=_parse_tool_calls(row["tool_calls"]),
        tool_call_id=row["tool_call_id"],
    )


def _parse_tool_calls(raw: str | None) -> list[ToolCallInfo] | None:
    """Parse a JSON-encoded tool_calls column, or return None."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return [ToolCallInfo(**tc) for tc in data]
    except (json.JSONDecodeError, TypeError, KeyError):
        return None


# ── Session CRUD ──────────────────────────────────────────────────────────────


async def list_sessions(db: aiosqlite.Connection) -> list[SessionSummary]:
    """Return all sessions, most-recently updated first."""
    cursor = await db.execute(
        "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC",
    )
    rows = await cursor.fetchall()
    return [_row_to_summary(row) for row in rows]


async def create_session(db: aiosqlite.Connection) -> SessionSummary:
    """Create a new empty session and return its summary."""
    session_id = str(uuid.uuid4())
    now = _now_iso()
    await db.execute(
        "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (session_id, "", now, now),
    )
    await db.commit()
    return SessionSummary(id=session_id, title="", created_at=now, updated_at=now)


async def get_session(db: aiosqlite.Connection, session_id: str) -> SessionDetail | None:
    """Load a session with all of its messages.  Returns ``None`` if not found."""
    cursor = await db.execute(
        "SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?",
        (session_id,),
    )
    row = await cursor.fetchone()
    if row is None:
        return None

    msg_cursor = await db.execute(
        "SELECT role, content, created_at, tool_calls, tool_call_id"
        " FROM messages WHERE session_id = ? ORDER BY id",
        (session_id,),
    )
    msg_rows = await msg_cursor.fetchall()

    return SessionDetail(
        id=row["id"],
        title=row["title"],
        messages=[_row_to_message_read(m) for m in msg_rows],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def delete_session(db: aiosqlite.Connection, session_id: str) -> bool:
    """Delete a session (and its messages via CASCADE).  Returns whether it existed."""
    cursor = await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    await db.commit()
    return cursor.rowcount > 0


async def update_session_title(
    db: aiosqlite.Connection, session_id: str, title: str
) -> SessionSummary | None:
    """Rename a session.  Returns ``None`` if not found."""
    now = _now_iso()
    cursor = await db.execute(
        "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
        (title, now, session_id),
    )
    await db.commit()
    if cursor.rowcount == 0:
        return None

    read_cursor = await db.execute(
        "SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?",
        (session_id,),
    )
    row = await read_cursor.fetchone()
    if row is None:  # pragma: no cover — should not happen after successful update
        return None
    return _row_to_summary(row)


# ── Message helpers ───────────────────────────────────────────────────────────


async def add_message(
    db: aiosqlite.Connection,
    session_id: str,
    role: str,
    content: str,
    *,
    tool_calls: str | None = None,
    tool_call_id: str | None = None,
) -> None:
    """Insert a message and bump the session's ``updated_at`` timestamp."""
    now = _now_iso()
    await db.execute(
        "INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (session_id, role, content, tool_calls, tool_call_id, now),
    )
    await db.execute(
        "UPDATE sessions SET updated_at = ? WHERE id = ?",
        (now, session_id),
    )
    await db.commit()


async def get_messages(db: aiosqlite.Connection, session_id: str) -> list[ChatMessage]:
    """Return all messages for a session in insertion order (for OpenAI)."""
    cursor = await db.execute(
        "SELECT role, content, tool_calls, tool_call_id"
        " FROM messages WHERE session_id = ? ORDER BY id",
        (session_id,),
    )
    rows = await cursor.fetchall()
    return [
        ChatMessage(
            role=row["role"],
            content=row["content"],
            tool_calls=_parse_tool_calls(row["tool_calls"]),
            tool_call_id=row["tool_call_id"],
        )
        for row in rows
    ]


async def get_messages_with_timestamps(
    db: aiosqlite.Connection, session_id: str
) -> list[MessageEvent]:
    """Return all messages with timestamps for history replay via SSE."""
    cursor = await db.execute(
        "SELECT role, content, created_at, tool_calls, tool_call_id"
        " FROM messages WHERE session_id = ? ORDER BY id",
        (session_id,),
    )
    rows = await cursor.fetchall()
    return [
        MessageEvent(
            role=row["role"],
            content=row["content"],
            created_at=row["created_at"],
            tool_calls=_parse_tool_calls(row["tool_calls"]),
            tool_call_id=row["tool_call_id"],
        )
        for row in rows
    ]


async def session_exists(db: aiosqlite.Connection, session_id: str) -> bool:
    """Check whether a session exists."""
    cursor = await db.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,))
    return await cursor.fetchone() is not None


async def auto_title_if_needed(
    db: aiosqlite.Connection, session_id: str, content: str
) -> None:
    """Set the session title from the first user message if it is still empty."""
    cursor = await db.execute("SELECT title FROM sessions WHERE id = ?", (session_id,))
    row = await cursor.fetchone()
    if row is None or row["title"] != "":
        return

    title = content[:50]
    if len(content) > 50:
        title += "…"

    await db.execute(
        "UPDATE sessions SET title = ? WHERE id = ?",
        (title, session_id),
    )
    await db.commit()
