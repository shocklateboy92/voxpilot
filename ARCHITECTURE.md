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

`frontend/src/platform/connection.ts` owns the single OpenCode client. The server URL is
selected from a deployment-owned `config.json`, parsed with a small shape check
in `frontend/src/platform/connection-config.ts`. The frontend loads it before creating the
client, using a same-origin, no-store request. Only the chosen server ID persists;
configured passwords remain in memory and are refetched on reload. Site access
grants access to all listed backend credentials, so network/proxy protection must
cover the config endpoint as well as the UI. A missing file (404) enables the
manual flow; invalid or inaccessible config fails closed.

In the manual flow, the URL is stored in localStorage and the password in sessionStorage
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

Solid Router owns session/file URL state, native file-link interception, and browser
history; backend changes still reload the app to recreate its authenticated client.

## Message attachments

Both new chats and existing sessions use `features/chat/MessageComposer.tsx`.
Drafts are session-scoped, survive failed sends and navigation, and stay in memory
only. `platform/prompt-files.ts` encodes attachments as data URIs for native
`session.prompt`; OpenCode owns durable storage, and history renders its saved
user-message `files`. There is no separate upload endpoint or attachment database.

## Markdown files

The file viewer reads current contents through the authenticated native file API
and shares Markdown rendering with chat. File links are resolved at render time
against the owning session or document directory, without modifying saved messages.
Viewer URLs retain backend and location context across reloads and new tabs.

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

Snapshots use `snapshot/<uuid>` keys in plugin storage. There is no VoxPilot
database or Drizzle migration system. Review references created by the retired
backend are intentionally unsupported.

## Packages and release

- `plugin/src`: shared RPC schema, native plugin, Git/format/render services.
- `plugin/tests`: formatter and real OpenCode HTTP integration tests.
- `frontend/src`: connection screen, chat, review UI and native API wrappers.
- `frontend/e2e`: browser tests against the authenticated dev OpenCode service using GPT-6 Luna and disposable test repositories.
- `packaging`: exec launcher, systemd unit, Caddy example, installation docs.

The plugin bundle includes JS dependencies and needs no install-time npm commands.
Native Git, Ruff and clang-format remain host prerequisites. Static frontend and
plugin artifacts are released together; the RPC exposes protocol version 1 so
the connection screen can detect incompatible frontend/plugin combinations.
