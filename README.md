# VoxPilot

Self-hosted, web-based AI coding assistant. Wraps the [OpenCode](https://opencode.ai) agent runtime with a mobile-first SolidJS frontend and an interactive diff review system. Runs on local hardware, accessible from any device on the network.

## Prerequisites

- [Bun 1.3+](https://bun.sh/)
- [Node.js 22+](https://nodejs.org/)
- [just](https://github.com/casey/just)
- [OpenCode 2.x](https://opencode.ai/v2/docs/) (`@opencode/cli`, tested with 2.0.22). The old `opencode-ai` 1.x binary is not compatible.
- An OpenAI-compatible inference server (e.g. [Ollama](https://ollama.ai/))

## Quick Start

```bash
cp .env.example .env          # Configure the OpenCode binary and app ports
just install                 # Install dependencies
just dev                     # Start backend (:8001) + frontend (:3000)
```

Configure models and credentials through OpenCode's own configuration. VoxPilot
starts a private, authenticated loopback server; it does not manage the shared
OpenCode service. Use `VOXPILOT_OC_BINARY` to select a separately installed V2
binary without replacing an existing V1 installation. Separate processes still
share OpenCode data/configuration by default; use the isolated browser harness
when validating a migration without touching existing sessions or credentials.

See [browser regression tests](frontend/e2e/README.md) for a disposable setup.

## Commands

| Recipe | Description |
|---|---|
| `just install` | Install all dependencies (backend + frontend) |
| `just dev` | Run both servers concurrently |
| `just dev-backend` | Backend only (Bun with hot reload on :8001) |
| `just dev-frontend` | Frontend only (Vite on :3000, proxies to :8001) |
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
- **Agent**: OpenCode 2.x via `@opencode/client` and a private server process
- **Tools**: MCP server (show_diff)

See [ARCHITECTURE.md](ARCHITECTURE.md) for full details.
