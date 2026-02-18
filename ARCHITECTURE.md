# VoxPilot — Architecture Document

## Goal

VoxPilot is a **self-hosted, web-based AI coding assistant** — an alternative to cloud-hosted tools like Claude Code and GitHub Copilot. It runs on your local machine and exposes a web UI, enabling **remote development from mobile devices** (phone, tablet) by connecting to the local instance over the network.

## Current State

Chat interface to AI models (GPT-4o, etc.) via the **GitHub Models API**. Users authenticate with GitHub OAuth; their access token is reused as the API key for inference. Conversations are persisted in SQLite with session management.

## Stack

- **Backend**: Python 3.13, FastAPI, Pydantic v2, `uv`, Pyright (strict), Ruff
- **Frontend**: Vanilla TypeScript 5.7 (no framework), esbuild, `openapi-fetch`
- **Database**: SQLite via `aiosqlite` (WAL mode, foreign keys enabled)
- **Task runner**: `just` (see Justfile for all recipes)
- **Tests**: pytest-asyncio with `httpx.ASGITransport` (no live server), in-memory SQLite

## Architecture

```
Browser (vanilla TS SPA)
  │  openapi-fetch, type-safe, cookies
  │
  ▼  HTTP/JSON + SSE
FastAPI (uvicorn :8000)
  ├── /api/auth/*         → GitHub OAuth (httpx)        → github.com
  ├── /api/sessions/*     → Session CRUD (aiosqlite)    → voxpilot.db
  ├── /api/chat           → OpenAI SDK (AsyncOpenAI)    → models.inference.ai.azure.com
  ├── /api/health
  └── /* (production)     → static files from frontend/dist/
```

## Data Model

```
sessions                          messages
┌──────────────────────┐         ┌──────────────────────────┐
│ id         TEXT PK   │◄───────┤│ session_id TEXT FK        │
│ title      TEXT      │         │ id         INTEGER PK AI  │
│ created_at TEXT      │         │ role       TEXT            │
│ updated_at TEXT      │         │ content    TEXT            │
└──────────────────────┘         │ created_at TEXT            │
                                 └──────────────────────────┘
```

- ON DELETE CASCADE: deleting a session removes its messages.
- Session IDs are UUIDs (server-generated).
- Messages ordered by autoincrement `id` (insertion order).

## Key Conventions

- **API contract pipeline**: Backend schema changes must flow through `just generate` → exports OpenAPI spec → `openapi-typescript` generates `frontend/src/api.d.ts` → compile-time type safety on frontend API calls.
- **Auth**: GitHub token stored in plain `HttpOnly`/`SameSite=Lax` cookie (`gh_token`). No JWT. The `GitHubToken` dependency (`dependencies.py`) extracts it or raises 401.
- **Config**: `pydantic-settings` with `VOXPILOT_` env prefix. `.env` auto-loaded by Justfile. Key settings: `db_path` (default `voxpilot.db`), `github_client_id`, `github_client_secret`.
- **DB lifecycle**: `init_db()`/`close_db()` managed via FastAPI `lifespan`. Single shared `aiosqlite.Connection` (sufficient for single-user). `get_db()` dependency provides it to routes.
- **Backend layout**: src layout (`backend/src/voxpilot/`). Routes in `api/routes/`, services in `services/`, schemas in `models/schemas.py`, DB in `db.py`.
- **Chat flow**: Frontend sends `{ session_id, content, model }`. Backend persists user message → loads full history from DB → streams to LLM → persists assistant message on completion. Auto-titles session from first message (first 50 chars).
- **Row mapping**: `aiosqlite.Row` (dict-like access) → Pydantic models via explicit constructors in `services/sessions.py`. ~15 lines total, fully typed.
- **Frontend**: `main.ts` manages session sidebar + chat area. No in-memory message array; state lives in the DB. Sessions loaded via REST, chat streamed via SSE.
- **Production**: `just build` bundles frontend; `create_app()` auto-mounts `frontend/dist/` if it exists. Single uvicorn process serves everything.
- **Tests**: `conftest.py` has `autouse` fixture calling `init_db(":memory:")` — every test gets a fresh in-memory DB.

## Design Decisions

| Decision | Rationale |
|---|---|
| **No frontend framework** | Minimal scope; vanilla TS keeps bundle tiny and avoids churn |
| **openapi-fetch + codegen** | Type-safe API calls; contract enforced at compile time |
| **GitHub token as Models API key** | GitHub Models accepts OAuth tokens directly; no separate key management |
| **Cookie auth (no JWT)** | Simpler; `HttpOnly` mitigates XSS; no refresh logic needed |
| **SQLite via raw aiosqlite** | Async-safe, single-file DB, no ORM. SQLModel rejected for poor Pyright strict compat |
| **Backend owns history** | Frontend sends only session_id + new message; single source of truth |
| **Auto-title from first message** | No extra LLM call; `content[:50]` is fast and sufficient |
| **OpenAI SDK for GitHub Models** | Compatible API; reuses mature SDK |
| **src layout** | Python packaging best practice; prevents root imports |
