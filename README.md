# VoxPilot

FastAPI backend + vanilla HTML/CSS/TypeScript frontend monorepo.

## Prerequisites

- [Python 3.13+](https://www.python.org/)
- [uv](https://docs.astral.sh/uv/) — Python package manager
- [Node.js 22+](https://nodejs.org/) — frontend toolchain
- [just](https://github.com/casey/just) — command runner

### Arch Linux

```bash
sudo pacman -S python uv nodejs npm just
```

## Quick Start

```bash
# Install all dependencies
just install

# Run backend dev server (http://localhost:8000)
just dev-backend

# In another terminal, run frontend watcher
just dev-frontend
```

## Available Recipes

| Recipe | Description |
|---|---|
| `just install` | Install all dependencies (backend + frontend) |
| `just dev-backend` | Start FastAPI dev server with hot reload on :8000 |
| `just dev-frontend` | Start esbuild watcher for frontend |
| `just test` | Run backend tests |
| `just lint` | Lint backend (Ruff) + frontend (tsc) |
| `just typecheck` | Type check backend (Pyright strict) + frontend (tsc strict) |
| `just format` | Format backend code with Ruff |
| `just build` | Build frontend for production |
| `just clean` | Remove build artifacts |
| `just check` | Run install + lint + typecheck + test |

## Project Structure

```
voxpilot/
├── backend/
│   ├── src/voxpilot/       # Python source (src layout)
│   │   ├── api/routes/      # FastAPI route handlers
│   │   ├── models/          # Pydantic v2 schemas
│   │   ├── services/        # Business logic
│   │   ├── core/            # Core utilities
│   │   ├── main.py          # FastAPI app entry point
│   │   ├── config.py        # Settings (pydantic-settings)
│   │   └── dependencies.py  # Shared FastAPI dependencies
│   ├── tests/               # pytest tests
│   └── pyproject.toml       # Python project config
├── frontend/
│   ├── src/                 # TypeScript + CSS source
│   ├── public/              # Static HTML
│   ├── dist/                # Build output (gitignored)
│   ├── tsconfig.json        # TypeScript strict config
│   └── package.json         # Node project config
├── Justfile                 # Task runner
└── .editorconfig            # Editor settings
```

## Tech Stack

| Layer | Tool | Purpose |
|---|---|---|
| Backend | FastAPI 0.115+ | Web framework |
| Backend | Pydantic v2 | Data validation |
| Backend | Uvicorn | ASGI server |
| Backend | Pyright (strict) | Static type checking |
| Backend | Ruff | Linting + formatting |
| Backend | uv | Package management |
| Backend | pytest | Testing |
| Frontend | TypeScript 5.7+ (strict) | Type-safe JavaScript |
| Frontend | esbuild | Fast bundling |
| Task runner | just | Command runner |
