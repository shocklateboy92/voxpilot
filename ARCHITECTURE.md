# VoxPilot architecture

## Runtime

```
Central Caddy static site → browser SolidJS application
                                   │
                                   ├─ OpenCode HTTP API + SSE
                                   ├─ OpenCode plugin RPC
                                   └─ Standalone speech HTTP service → OpenAI
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

## Recorded speech

`speech/` is a separate always-on process, not another coding API and not part
of static hosting. The browser calls it directly through HTTPS after fetching
the original session/project's vocabulary from its authenticated OpenCode client.
`plugin/src/speech-contract.ts` is the shared browser-safe Zod contract; service
and frontend infer their request/response types from it. The service receives
binary audio and a request-specific vocabulary snapshot, never project paths,
conversations, clipboard contents, code or benchmark reference transcripts.

Optional runtime `config.json.speech` supplies the service URL and a speech-only
bearer token. That token stays in browser memory; it is not an OpenAI credential.
Exact-origin CORS and bearer authentication protect service requests. The OpenAI
key is held only by the speech service, read from a private development file or
its encrypted homelab systemd credential. Neither static assets, Caddy's runtime
config generator nor OpenCode backends receive the key.

Normal voice Finish is a transcription-and-chat action, not clip collection.
The user has selected OpenAI dictation for this deployment; no per-recording
permission checkbox or local-only playback/download step is shown. The complete
utterance is transcribed with OpenAI
`gpt-transcribe` and `keywords[]`, without a separate LLM cleanup pass or live
transcript. ffmpeg pipe-only decoding checks actual duration; WebRTC VAD rejects
silence/quiet noise before cloud calls. The guard is not a guarantee against
background speech or all transcription inventions.

The service bounds bytes, duration, concurrency, request rates and runtime.
Normal audio is never written to storage. A bounded, single-instance 15-minute
memory cache deduplicates IDs/bodies and remembers failed/cancelled outcomes;
it is lost on service restart. Explicit cancellation aborts codec/provider work,
but cannot guarantee refunds after provider processing begins. No automatic paid
retries occur. A deliberately new paid attempt has a new ID and explicit user
confirmation. See `speech/CONTRACT.md` for protocol details.

Transcription and chat admission remain separate. The composer captures original
draft/session/backend ownership before async work, retains correction/retry and
Type paths, and consumes only an accepted send snapshot. Pasted references keep
their stable numbers and images use the existing native prompt file flow.
There is no sample collector or audio-storage RPC in the coding plugin.
The microphone-capture widget sends its result to a callback captured before
microphone permission awaits. Backgrounding cancels capture. Normal recordings
allocate no audio preview object URL, and recovery never requires audio playback.

Homelab activation is currently chapel-only, with a supervised non-root Quadlet,
read-only credential mount and resource limits. Production activation requires
a separate operator decision. See `packaging/SPEECH.md`.

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
- `speech`: standalone transcription runtime, acoustic guard and isolated
  service/provider tests.
- `packaging`: exec launcher, systemd unit, Caddy example, installation docs.

The plugin bundle includes JS dependencies and needs no install-time npm commands.
Native Git, Ruff and clang-format remain host prerequisites. Static frontend and
plugin artifacts are released together; the RPC exposes protocol version 1 so
the connection screen can detect incompatible frontend/plugin combinations.
