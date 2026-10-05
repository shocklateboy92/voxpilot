# VoxPilot

Mobile-first coding UI for [OpenCode 2](https://opencode.ai/v2/docs/). VoxPilot
formats both versions of a file to the phone's character width **before**
computing the diff, including comment reflow.

## Architecture

- **Static frontend:** build once, serve on your Caddy host, connect to any host.
- **Native OpenCode plugin:** formatting RPCs, persistent review snapshots,
  `voxpilot_show_diff` agent tool, and desktop idle inhibition.
- **systemd service:** runs `opencode serve` directly via an `exec` launcher.
  OpenCode owns plugin lifecycle, HTTP authentication, API, and SSE.

There is no VoxPilot HTTP backend or MCP server. Plugin source and shared RPC
schemas live in `plugin/`; the frontend imports their inferred types.

## Development

Prerequisites: Bun, Node.js 22+, just, Git, native OpenCode 2.0.22, Ruff and
clang-format. Prettier is bundled. Provider configuration belongs to OpenCode.

```sh
cp .env.example .env
just install
just dev
```

Vite serves the frontend on port 3000 and proxies `/api` and `/auth` to OpenCode
on port 8001. Development uses the production launcher, including its standard
CORS origins, while overriding the plugin path to the source checkout. Open the
frontend and connect using its own URL and the development server password.
Rebuild the plugin and restart the development server after plugin edits.

```sh
just typecheck
just test       # formatter tests + real isolated OpenCode plugin integration
just lint
just build     # plugin/dist and frontend/dist
scripts/build-release.sh bun-linux-x64
```

The release includes a host-install tarball and a separate architecture-independent
`voxpilot-frontend-<version>.tar.gz` for central static hosting. The existing
dev-setup installer can continue extracting the host tarball and restarting its
systemd unit. Runtime installation requires neither Bun nor npm.

See [deployment instructions](packaging/README.md),
[architecture](ARCHITECTURE.md), and [browser tests](frontend/e2e/README.md).
