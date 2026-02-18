# VoxPilot — Architecture Document

## Goal

VoxPilot is a **self-hosted, web-based AI coding assistant** — an alternative to cloud-hosted tools like Claude Code and GitHub Copilot. It runs on your local machine and exposes a web UI, enabling **remote development from mobile devices** (phone, tablet) by connecting to the local instance over the network.

## Current State

Chat interface to AI models (GPT-4o, etc.) via the **GitHub Models API**. Users authenticate with GitHub OAuth; their access token is reused as the API key for inference.

## Stack

- **Backend**: Python 3.13, FastAPI, Pydantic v2, `uv`, Pyright (strict), Ruff
- **Frontend**: Vanilla TypeScript 5.7 (no framework), esbuild, `openapi-fetch`
- **Task runner**: `just` (see Justfile for all recipes)
- **Tests**: pytest-asyncio with `httpx.ASGITransport` (no live server)

## Architecture

```
Browser (vanilla TS SPA)
  │  openapi-fetch, type-safe, cookies
  │
  ▼  HTTP/JSON
FastAPI (uvicorn :8000)
  ├── /api/auth/*    → GitHub OAuth (httpx)        → github.com
  ├── /api/chat      → OpenAI SDK (AsyncOpenAI)    → models.inference.ai.azure.com
  ├── /api/health
  └── /* (production) → static files from frontend/dist/
```

## Key Conventions

- **API contract pipeline**: Backend schema changes must flow through `just generate` → exports OpenAPI spec → `openapi-typescript` generates `frontend/src/api.d.ts` → compile-time type safety on frontend API calls.
- **Auth**: GitHub token stored in plain `HttpOnly`/`SameSite=Lax` cookie (`gh_token`). No server sessions, no JWT. The `GitHubToken` dependency (`dependencies.py`) extracts it or raises 401.
- **Config**: `pydantic-settings` with `VOXPILOT_` env prefix. `.env` auto-loaded by Justfile.
- **Backend layout**: src layout (`backend/src/voxpilot/`). Routes in `api/routes/`, services in `services/`, schemas in `models/schemas.py`.
- **Frontend**: Single `main.ts` file, DOM manipulation via `.hidden` CSS class toggling, in-memory message history (no persistence).
- **Production**: `just build` bundles frontend; `create_app()` auto-mounts `frontend/dist/` if it exists. Single uvicorn process serves everything.

## Design Decisions

| Decision | Rationale |
|---|---|
| **No frontend framework** | Minimal scope; vanilla TS keeps bundle tiny and avoids churn |
| **openapi-fetch + codegen** | Type-safe API calls; contract enforced at compile time |
| **GitHub token as Models API key** | GitHub Models accepts OAuth tokens directly; no separate key management |
| **Cookie auth (no JWT)** | Simpler; `HttpOnly` mitigates XSS; no refresh logic needed |
| **No database** | Stateless — no sessions, no message persistence (yet) |
| **OpenAI SDK for GitHub Models** | Compatible API; reuses mature SDK |
| **src layout** | Python packaging best practice; prevents root imports |
