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
Alternatively, configure named servers and credentials in the Git-ignored
`frontend/config.local.json`; see `packaging/config.example.json` for the format.
Vite serves this runtime file without including it in production builds.
Rebuild the plugin and restart the development server after plugin edits.

```sh
just typecheck
just test       # formatter tests + real isolated OpenCode plugin integration
just test-e2e  # real dev backend; GPT-6 Luna for generated AI responses
just check     # typecheck, both test suites, and lint
just lint
just build     # plugin/dist and frontend/dist
scripts/build-release.sh bun-linux-x64
```

The release includes a host-install tarball and a separate architecture-independent
`voxpilot-frontend-<version>.tar.gz` for central static hosting. The existing
dev-setup installer can continue extracting the host tarball and restarting its
systemd unit. Runtime installation requires neither Bun nor npm.

## Personal frontend deployment

The frontend is deployed independently of the homelab tenant image. From a
LAN-connected machine with Python 3.12+:

```sh
just deploy-frontend                     # latest published GitHub release
just deploy-frontend '0.1.298+5951fb8'    # a specific release, including rollback
python3 scripts/deploy-frontend.py --release latest --dry-run
python3 scripts/deploy-frontend.py --directory frontend/dist
```

The deploy script verifies the release artifact's SHA-256 checksum, uploads
content-hashed assets first, and publishes `index.html` last using WebDAV
MOVE. It retains old assets for open tabs and refuses to overwrite an existing
asset with different content. Run only one deployment at a time. No SSH,
Caddy reload, tenant rebuild, or plugin restart is involved. Frontend-only
deployment does not update the native plugin; changes to the RPC contract may
also require updating the connected OpenCode hosts.

The default write destination is `https://push.apps.lasath.com/voxpilot/`;
read-back verification uses `https://static.apps.lasath.com/sysupdate/voxpilot/`.
The write endpoint is LAN-only and unauthenticated. Do not expose it to the
public Internet. `--push-url` and `--read-url` can select another host, but must
end in `/voxpilot`. Never publish `config.json`: the homelab's separate runtime
credential route owns it.

Homelab Caddy serves this directory at `https://voxpilot.apps.lasath.com/`.
The first hosting-route change must be applied separately; uploading assets
alone does not switch an existing image-baked frontend. Published files live
on versioned `/srv`: they survive reboots and carry forward with tenant
updates, but OS rollback can restore an older frontend. There is no baked
frontend fallback on a fresh installation; publish assets before enabling
the route.

See [deployment instructions](packaging/README.md),
[architecture](ARCHITECTURE.md), and [browser tests](frontend/e2e/README.md).
