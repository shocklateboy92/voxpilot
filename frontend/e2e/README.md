# Browser regression tests

Run against a real, isolated OpenCode backend using the machine's existing
configuration and GitHub Copilot account:

```sh
cd frontend
npm run test:e2e
```

Playwright builds the plugin and starts `packaging/voxpilot-opencode` on
**127.0.0.1:18001** with `OPENCODE_DB` pointing to a fresh database under
`/tmp/opencode/voxpilot-e2e-backend-*`. It never reuses an existing backend,
even when one is already listening on the test port. A dedicated Vite frontend
on **localhost:13000** proxies that backend; it is not reused either, so an old
frontend cannot silently proxy the normal database. `just dev` on ports 8001
and 3000 can keep running. Teardown stops the test backend before removing its
temporary database, including retained project metadata. Startup failure also
cleans up the backend and its directory. A small supervisor watches a pipe owned
by the runner, so an interrupted or killed runner also stops its backend and
removes the database instead of leaving an orphan server.
Install dependencies first with `just install` on a fresh checkout.

The connection form uses `OPENCODE_PASSWORD` from the environment or the repo's
`.env`, or a generated test password if neither is set. Provider login is assumed
to be complete on the normal local OpenCode service. Setup discovers that service
without starting it and reads only its active GitHub Copilot credential, then
imports it into the disposable backend via the typed credential API. Credential
values stay in memory: no export files, database copies, or logged secrets.
The source service is not modified. There is no mock provider or separate
OpenCode home; global configuration is still inherited. Account changes and
credential refreshes on the test backend stay in its disposable database.

## Generation and test data

All prompts use **GPT-6 Luna** (`github-copilot/gpt-6-luna`, normally thinking
`none`; selection coverage also exercises `low`).
The suite fails if the model is unavailable. The shared browser helper selects
it and checks the actual session model before forwarding every prompt.

Tests create a small Git repository under `/tmp/opencode/voxpilot-e2e-*` and
select it in the UI. Its local configuration pins all discovered agents and the
hidden title, summary, and compaction agents to Luna too. Warming and automatic
compaction are disabled for these test locations. Worktrees inherit the same
configuration. Test-created sessions are interrupted and deleted after each
test; test teardown removes test worktrees, saved permissions, and temporary files.
OpenCode may retain project metadata within the test database until suite teardown
deletes it. No test project records are written to the normal database.
`backend.spec.ts` verifies source-service isolation, database disposal, fresh
subsequent startup, refusal to reuse an occupied backend port, and cleanup after
the owning runner is killed.

Real prompts exercise streaming Markdown, cancellation, SSE recovery, reload,
model selection, questions, permissions, forks, worktrees, and plugin diff cards.
Assertions cover the rendered result and persisted transcript; generation tests
have longer timeouts to accommodate provider latency. Presentation tests cover
themes, narrow layouts, review geometry, focus, safe areas, and no-JavaScript
launch. Failure screenshots and browser errors are attached to the report.

Routing tests cover native file-link interception, session/document back and forward,
reloads, and new tabs. Additional native API-created histories cover paginated transcripts and session lists, selected-turn
forks, session switching during generation, scroll restoration, touch navigation,
all specialized tool-card families, background completion/failure, typed forms,
permission rejection/saving, review resize and stable snapshots, branch review,
missing snapshots, request failure recovery, offline overlays, wake requests,
and wake-lock lifecycle. No fake AI provider is used. Failed-request and device
tests isolate their fault injection to the test page; wake tests never send a
request to the real host's wake endpoint.

Each test owns its repository so comparisons and saved permissions cannot leak
into subsequent tests. `just test-e2e` runs the browser suite; `just check` now
includes it. `connection.spec.ts` covers runtime config selection, fresh devices,
reload/credential rotation, storage, removed IDs, invalid/denied config, and manual
fallback against the real dev backend. Existing scenarios force config 404 to
retain manual-flow coverage. Reverse-proxy access policy and deployment CORS still
require deployment verification. Chromium emulation is not a substitute
for occasional verification on a physical phone.

The GitHub release build does not run this credential-dependent suite. Run
`just check` locally before releasing; no provider credentials are copied into CI.

## Overrides

- `VOXPILOT_E2E_URL`: frontend URL (default `http://localhost:13000`).
- `VOXPILOT_E2E_API`: test backend origin (default `http://127.0.0.1:18001`).
  Only local HTTP origins are accepted. The runner always starts an isolated
  backend there; this is not an opt-in to reuse an existing server.
- `VOXPILOT_E2E_AUTH_SERVER`: optional existing credential-source server URL.
  Authenticates with `OPENCODE_PASSWORD`. When omitted, setup uses local service
  discovery and its registered authentication. Only credentials are read from
  this source; test mutations always go to the isolated backend.
- `VOXPILOT_E2E_CHROMIUM`: Chromium executable (default `/usr/bin/chromium`).
- `VOXPILOT_E2E_CDP`: attach to an existing browser. The runner reuses its context
  and only closes tabs it creates. Network, touch, and JavaScript-disabled tests
  use isolated local Chromium and are skipped in CDP mode.

Reports are in `test-results/` and `playwright-report/`.
`npm run typecheck` includes the E2E helpers and Playwright configuration.
