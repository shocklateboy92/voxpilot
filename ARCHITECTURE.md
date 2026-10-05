# VoxPilot architecture

## Runtime

```
Central Caddy static site → browser SolidJS application
                                   │
                                   ├─ OpenCode HTTP API + SSE
                                   └─ OpenCode plugin RPC
                                          │
systemd → exec opencode serve → VoxPilot plugin
                                 ├─ compare / snapshot / formatComparison
                                 ├─ voxpilot_show_diff agent tool
                                 └─ location-filtered idle inhibition
```

`packaging/voxpilot-opencode` supplies the bundled plugin through
`OPENCODE_CONFIG_CONTENT` using OpenCode's environment substitution, then replaces
itself with `opencode serve`. The setting applies across locations in that server;
it does not modify global config. Global provider/agent settings still apply.
Plugin activation is location-scoped and asynchronous; the frontend waits for the
plugin RPC at connection time. Cleanup belongs to OpenCode.

## Frontend and authentication

`frontend/src/connection.ts` owns the single OpenCode client. The server URL is
stored in localStorage, while an optionally entered password lives in sessionStorage
and is sent as Basic auth. Existing pairing cookies are supported for same-origin
connections. No password is compiled into static assets. Connections can be
changed from the bottom navigation, or with `?connect=1`.

Central hosting requires each API host to allow the exact frontend origin via
`--cors`. HTTPS frontends require HTTPS API endpoints (typically homelab Caddy
reverse proxies). An authenticated browser talks directly to OpenCode; there is no
credential-injecting VoxPilot proxy. OpenCode 2.0.22's CORS responses do not permit
cross-origin credentialed fetch; remote connections use an explicit Authorization
header and omit browser cookies. Pairing cookies are used only on the same origin.

`rpc.ts` calls `client.rpc(VoxPilotRpc)`. The contract in `plugin/src/rpc.ts` uses
Zod Standard Schema and infers request, handler and frontend response types without
Hono, code generation, or manually synchronized interfaces. It is browser-safe.

The native live-only event stream reconnects and reconciles HTTP snapshots on
`server.connected`. Existing per-message fragment revision handling and paginated
history remain in `streaming.ts` and `api-client.ts`.

## Width-aware review

Both the agent tool and the UI's Review changes button call the same comparison
service. It pins commit refs, enumerates changed/untracked files with NUL-delimited
Git output, and stores complete before/after contents in OpenCode's durable
plugin storage. Snapshots preserve the captured working copy as the user resizes
or revisits a review. Capture is not an atomic filesystem transaction.

The UI supports HEAD → working copy, base merge-base → working copy, and base
merge-base → HEAD. The agent additionally accepts Git refs and INDEX comparisons.
Renames are represented as deletion/addition. Binary comparisons report an error.

`formatComparison` formats both full files with the requested printWidth using
Prettier, Ruff, or clang-format, reflows comments, recomputes line differences and
returns escaped diff HTML. Formatting never edits the repository. Existing
formatter fallback behavior preserves raw code when a formatter cannot run.

Snapshots use `snapshot/<uuid>` keys in plugin storage. Old `[ref:uuid]` chat
cards remain recognizable. When `VOXPILOT_LEGACY_DB` points at a former cache,
the plugin imports requested entries read-only and saves them into plugin storage.
Old database files are never deleted or migrated in place. There is no new
VoxPilot database or Drizzle migration system.

## Packages and release

- `plugin/src`: shared RPC schema, native plugin, Git/format/render services.
- `plugin/tests`: formatter and real OpenCode HTTP integration tests.
- `frontend/src`: connection screen, chat, review UI and native API wrappers.
- `frontend/e2e`: isolated OpenCode service, deterministic provider and browser tests.
- `packaging`: exec launcher, systemd unit, Caddy example, installation docs.

The plugin bundle includes JS dependencies and needs no install-time npm commands.
Native Git, Ruff and clang-format remain host prerequisites. Static frontend and
plugin artifacts are released together; the RPC exposes protocol version 1 so
the connection screen can detect incompatible frontend/plugin combinations.
