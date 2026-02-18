"""SQLite database lifecycle management via aiosqlite."""

import aiosqlite

_connection: aiosqlite.Connection | None = None

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT NOT NULL PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role         TEXT    NOT NULL,
    content      TEXT    NOT NULL,
    tool_calls   TEXT,
    tool_call_id TEXT,
    created_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_messages_session
    ON messages(session_id, id);
"""


async def init_db(path: str) -> None:
    """Open the database connection and create tables if needed."""
    global _connection
    conn = await aiosqlite.connect(path)
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = aiosqlite.Row
    await conn.executescript(_SCHEMA)
    await conn.commit()
    _connection = conn


async def close_db() -> None:
    """Close the database connection."""
    global _connection
    if _connection is not None:
        await _connection.close()
        _connection = None


def get_db() -> aiosqlite.Connection:
    """Return the active database connection.

    Raises ``RuntimeError`` if the database has not been initialised.
    """
    if _connection is None:
        msg = "Database not initialised — call init_db() first"
        raise RuntimeError(msg)
    return _connection
