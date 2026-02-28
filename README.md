# VoxPilot

Self-hosted, web-based AI coding assistant. Wraps the [OpenCode](https://opencode.ai) agent runtime with a mobile-first SolidJS frontend and an interactive diff review system. Runs on local hardware, accessible from any device on the network.

## Prerequisites

- [Bun 1.3+](https://bun.sh/)
- [Node.js 22+](https://nodejs.org/)
- [just](https://github.com/casey/just)
- An OpenAI-compatible inference server (e.g. [Ollama](https://ollama.ai/))

## Quick Start

```bash
cp .env.example .env        # Configure LLM endpoint and model
just install                 # Install dependencies
just dev                     # Start backend (:8000) + frontend (:3000)
```

## Commands

| Recipe | Description |
|---|---|
| `just install` | Install all dependencies (backend + frontend) |
| `just dev` | Run both servers concurrently |
| `just dev-backend` | Backend only (Bun with hot reload on :8000) |
| `just dev-frontend` | Frontend only (Vite on :3000, proxies to :8000) |
| `just test` | Run backend tests |
| `just lint` | Biome + tsc type checking |
| `just typecheck` | tsc --noEmit for both packages |
| `just format` | Biome auto-fix |
| `just build` | Production frontend build |
| `just build-static` | Build + copy to backend/static/ |
| `just check` | install + lint + typecheck + test |

## Stack

- **Backend**: TypeScript, Bun, Hono, Drizzle ORM, SQLite
- **Frontend**: SolidJS, TypeScript, Vite
- **Agent**: OpenCode SDK (embedded server)
- **Tools**: MCP server (show_diff)

See [ARCHITECTURE.md](ARCHITECTURE.md) for full details.
