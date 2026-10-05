# VoxPilot

Follow [AGENTS.md](../AGENTS.md) for coding conventions and
[ARCHITECTURE.md](../ARCHITECTURE.md) for the runtime layout.

VoxPilot is a static SolidJS frontend and a native OpenCode 2 plugin. The plugin
owns formatting, snapshot storage, the agent diff tool and typed RPCs. systemd
supervises OpenCode directly. There is no Hono backend or MCP server.

- `plugin/src/rpc.ts`: shared Zod RPC contract, imported by frontend via `@plugin`.
- `plugin/src/services`: Git capture, formatting, comment reflow and HTML rendering.
- `frontend/src/connection.ts`: selected OpenCode host and authentication.
- `frontend/src/rpc.ts`: typed plugin subclient.
- `frontend/src/streaming.ts`: native SSE and HTTP reconciliation.
- `packaging`: service, exec launcher and deployment instructions.

Use `just install`, `just typecheck`, `just test`, `just lint`, `just build`.
Read `frontend/DESIGN_SYSTEM.md` before editing UI. Never use `any` or non-null
assertions; prefer narrowing. Derive UI types from the shared RPC/client contracts.
