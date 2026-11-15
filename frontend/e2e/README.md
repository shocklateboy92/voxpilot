# Browser regression tests

Run against a real, isolated OpenCode backend using the machine's existing
configuration and GitHub Copilot account:

```sh
cd frontend
npm run test:e2e
```

Ordinary voice tests mock speech responses and make no OpenAI requests. An
additional chapel-only integration smoke is explicitly opt-in:

```sh
VOXPILOT_STAGING_SPEECH_SMOKE=1 VOXPILOT_E2E_AUTH_SERVER=http://127.0.0.1:8001 \
  npm run test:e2e -- e2e/voice-staging.spec.ts --workers=1 --retries=0
```

It synthesizes speech with `espeak-ng`, captures it through the real browser
MediaRecorder, checks the preview-free Record/Finish flow, calls the deployed chapel speech
service, and admits the result through the existing native chat UI into an
isolated test backend. It creates vocabulary only in that test's disposable
project and uses no personal recordings or real user project files. Trace/video
capture is disabled so the browser-readable speech token never enters artifacts.
The isolated HTTP test origin is bridged to the real HTTPS service in the test
harness; exact HTTPS origin/authentication behavior is verified separately on
the deployed endpoint. This is a paid test, never an automatic regression retry.

Playwright builds the plugin once. Each worker that needs the native API starts
its own `packaging/voxpilot-opencode`, disposable database, and Vite frontend.
Backend ports start at **127.0.0.1:18001** and frontend ports at
**localhost:13000**, offset by Playwright's worker index. Replacement workers get
new ports too. Existing backends and frontends are never reused; a process on an
occupied port causes startup failure rather than silent reuse. The fixture checks
that the frontend proxy reaches its own backend PID. `just dev` on ports 8001 and
3000 can keep running.

Databases, repositories, and worktrees live beneath each worker's
`/tmp/opencode/voxpilot-e2e-backend-*` directory. Teardown stops the backend before
removing that entire directory, including retained project metadata. Startup
failure also cleans up. A supervisor watches a pipe owned by the worker, so a
killed worker also stops its backend and removes its database and workspaces.
Install dependencies first with `just install` on a fresh checkout.

Tests run fully parallel across six workers, including tests in the same file.
Each test owns its browser context and repository. No sessions, events, or
database state cross worker boundaries. Tests within a worker run sequentially;
an automatic fixture asserts that the session list is empty both before each
test and after its workspace teardown. Lifecycle tests inspect only their own
temporary directories, so they can run concurrently too. To tune concurrency or
debug with one worker, use Playwright's standard override:

```sh
npm run test:e2e -- --workers=2
npm run test:e2e -- --workers=1
```

The previous shared-backend harness took about 57 seconds at six workers and
failed at higher worker counts. Worker isolation removes accidental concurrent
session/navigation interference rather than masking it with retries. Six remains
the default; higher counts can be used to stress the harness.

Final validation on the 32-CPU development host (87 tests, no retries):

| Workers | Wall time | Result |
| --- | --- | --- |
| 6 | 41.5 seconds | All passed |
| 16 | 33.5 and 33.3 seconds | Both runs passed |

CDP mode defaults to one worker because it reuses an existing browser context
and its local storage. Do not increase concurrency in that mode.

The connection form uses `OPENCODE_PASSWORD` from the environment or the repo's
`.env`, or a generated test password if neither is set. Provider login is assumed
to be complete on the normal local OpenCode service. Each API worker discovers
that service without starting it and reads only its active GitHub Copilot
credential, then imports it into its disposable backend via the typed API. Credential
values stay in memory: no export files, database copies, or logged secrets.
The source service is not modified. There is no mock provider or separate
OpenCode home; global configuration is still inherited. Account changes and
credential refreshes on the test backend stay in its disposable database.

## Fixture choices and synchronization

- Pure checks import `test` from `@playwright/test`; they start no servers.
- Browser-only module tests import `frontendTest` from `./fixtures`; they get
  Vite and `baseURL`, without a backend or provider credentials.
- Native API and connection tests import `test` from `./fixtures`; they get
  isolated worker servers and the session-leak checks.
- App scenarios import `test` from `./browser`, adding a test-owned repository,
  context, page, manual connection flow, and model guard.

`send()` waits for successful prompt admission and one additional rendered user
message, so matching an earlier identical prompt cannot pass the check. `idle()`
waits for the native session to finish as well as for the UI to become idle.
`openSession()` loads a fresh document at the intended session URL; it does not
race a hash change against an old page's incomplete session list. Event-stream
readiness checks belong to that new document. Tests of intentionally overlapping
clients still share a backend explicitly within their own scenario.

## Generation and test data

All prompts use **GPT-6 Luna** (`github-copilot/gpt-6-luna`, normally thinking
`none`; selection coverage also exercises `low`).
The suite fails if the model is unavailable. The shared browser helper selects
it and checks the actual session model before forwarding every prompt.

Tests create a small Git repository beneath their worker's disposable root and
select it in the UI. Its local configuration pins all discovered agents and the
hidden title, summary, and compaction agents to Luna too. Warming and automatic
compaction are disabled for these test locations. Worktrees inherit the same
configuration. Test-created sessions are interrupted and deleted after each
test; test teardown removes test worktrees, saved permissions, and temporary files.
OpenCode may retain project metadata within the test database until worker teardown
deletes it. No test project records are written to the normal database.
`backend.spec.ts` verifies source-service and cross-backend isolation, disposal, fresh
subsequent startup, refusal to reuse an occupied backend port, and cleanup after
the owning runner is killed.

Real prompts exercise streaming Markdown, cancellation, SSE recovery, reload,
model selection, questions, permissions, forks, worktrees, and plugin diff cards.
Assertions cover the rendered result and persisted transcript; generation tests
have longer timeouts to accommodate provider latency. Presentation tests use
native API-created histories rather than live generation to cover
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

`scroll-anchor.spec.ts` exercises layout/scroll event ordering, rapid tool
disclosure changes, pane/composer resizing, concurrent user scrolling, and
incremental position restoration in Chromium without a provider. `scrolling.spec.ts`
adds real Luna tool turns and streaming, recording per-frame scroll gaps and tool
disclosure states in a `scroll-layout` report attachment. Both verify that following
survives layout changes without pulling a reader away from history.

Offline coverage also verifies that going offline aborts the event stream and
that reconnecting reconciles sessions created while it was disconnected. This
prevents events from other clients from triggering failed background refreshes
while the page is offline.

Form coverage includes pending questions in idle sessions: project refreshes
must preserve both the question and its unsubmitted answer, and reloading must
restore the pending question even when no generation is running.

Shell-output coverage holds a real request in flight while session metadata
changes, verifying that unchanged polling inputs do not restart it. Fork
deletion checks wait for the matching DELETE response and navigation away from
the deleted session rather than relying on child-session row styling.

Each test owns its repository so comparisons and saved permissions cannot leak
into subsequent tests. `just test-e2e` runs the browser suite; `just check` now
includes it. `connection.spec.ts` covers runtime config selection, fresh devices,
reload/credential rotation, storage, removed IDs, invalid/denied config, and manual
fallback against the real isolated backend. Existing scenarios force config 404 to
retain manual-flow coverage. Reverse-proxy access policy and deployment CORS still
require deployment verification. Chromium emulation is not a substitute
for occasional verification on a physical phone.

The GitHub release build does not run this credential-dependent suite. Run
`just check` locally before releasing; no provider credentials are copied into CI.

## Legacy PWA upgrades

`service-worker-retirement.spec.ts` uses a test-owned HTTP server and an actual
installed cache-serving worker. It verifies that replacing `sw.js` with the SPA
HTML fallback leaves old pages cached, and that the shipped retirement worker
unregisters and removes only legacy caches. Open drafts, unrelated caches and
browser storage remain untouched; the next navigation loads the current frontend.
It needs no backend, credentials or real transcription service.

## Voice composer

`voice-test.ts` supplies the shared browser setup, mount, clipboard, recording
and microphone helpers for both mocked voice suites. Error mocks use the real
service's error envelope so retryability and status codes cannot drift.

`voice-composer.spec.ts` uses the browser-only fixture and Chromium's synthetic
microphone, with mocked speech configuration and vocabulary, without a backend,
provider account, or real transcription service. It mounts `MessageComposer`
directly and covers voice-first input, live analyser levels, microphone cleanup,
permission races and failures, unsupported browsers, stable pasted-item numbers,
draft isolation, typing fallback, and narrow dark/light layouts. Run it with
`npm run test:e2e -- e2e/voice-composer.spec.ts e2e/voice-transcription.spec.ts e2e/composer-keyboard.spec.ts`.
Existing app scenarios explicitly select the remembered typing preference.

`voice-transcription.spec.ts` mocks the speech service, backend vocabulary and
prompt admission. Normal **Record a message → Finish recording** automatically
transcribes with `cloudAllowed: true` and sends through the native composer
callback, without a consent checkbox, preview, download or sample controls. Tests
assert that real captured recordings contain only blob, duration and the production
voice take, create no audio preview object URLs, and leave image preview URLs intact.
Additional tests
cover same-ID retries, explicit new paid attempts, no speech, prompt correction,
stale/session/project/backend work, accepted draft snapshots, vocabulary budgets,
capture cancellation/limits and narrow idle/recording/busy layouts. These browser-only
tests read no provider credentials and make no paid cloud calls. The separate
`vocabulary.spec.ts` agent scenarios use the native credential-backed fixture;
do not include them in mocked-only validation.
Native test servers keep user vocabulary paths beneath their disposable worker roots.

## Overrides

- `VOXPILOT_E2E_URL`: frontend base origin (default `http://localhost:13000`).
- `VOXPILOT_E2E_API`: backend base origin (default `http://127.0.0.1:18001`).
  Only local HTTP origins are accepted. The runner always starts an isolated
  backend there; this is not an opt-in to reuse an existing server. Both base
  ports are offset by the worker index; reserve enough consecutive ports for
  all workers and replacements. Separate concurrent runs need disjoint ranges.
- `VOXPILOT_E2E_AUTH_SERVER`: optional existing credential-source server URL.
  Authenticates with `OPENCODE_PASSWORD`. When omitted, workers use local service
  discovery and its registered authentication. Only credentials are read from
  this source; test mutations always go to the isolated backend.
- `VOXPILOT_E2E_CHROMIUM`: Chromium executable (default `/usr/bin/chromium`).
- `VOXPILOT_E2E_CDP`: attach to an existing browser. The runner reuses its context
  and only closes tabs it creates. Network, touch, and JavaScript-disabled tests
  use isolated local Chromium and are skipped in CDP mode.

Reports are in `test-results/` and `playwright-report/`.
`npm run typecheck` includes the E2E helpers and Playwright configuration.
