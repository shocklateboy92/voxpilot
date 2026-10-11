# Browser regression tests

Run against the real OpenCode dev backend with the machine's existing provider
credentials and configuration:

```sh
cd frontend
npm run test:e2e
```

Playwright reuses the backend on **127.0.0.1:8001**. If it is down, Playwright
builds the plugin and starts the normal `packaging/voxpilot-opencode` launcher.
It starts a dedicated Vite frontend on **localhost:13000**, proxying that
backend, so `just dev`'s frontend on port 3000 can keep running. Playwright stops
processes it started when the run ends; an existing dev backend stays running.
Install dependencies first with `just install` on a fresh checkout.

The connection form uses `OPENCODE_PASSWORD` from the environment or the repo's
`.env`, just like `just dev`. Provider login is assumed to be complete. There is
no mock provider, separate OpenCode home, or mutation opt-in flag.

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
test; test teardown removes test worktrees, saved permissions, and temporary files. OpenCode may
retain project metadata for the deleted temporary repository.

Real prompts exercise streaming Markdown, cancellation, SSE recovery, reload,
model selection, questions, permissions, forks, worktrees, and plugin diff cards.
Assertions cover the rendered result and persisted transcript; generation tests
have longer timeouts to accommodate provider latency. Presentation tests cover
themes, narrow layouts, review geometry, focus, safe areas, and no-JavaScript
launch. Failure screenshots and browser errors are attached to the report.

The suite contains 40 browser scenarios. Additional native API-created histories cover paginated transcripts and session lists, selected-turn
forks, session switching during generation, scroll restoration, touch navigation,
all specialized tool-card families, background completion/failure, typed forms,
permission rejection/saving, review resize and stable snapshots, branch review,
missing snapshots, request failure recovery, offline overlays, wake requests,
and wake-lock lifecycle. No fake AI provider is used. Failed-request and device
tests isolate their fault injection to the test page; wake tests never send a
request to the real host's wake endpoint.

Each test owns its repository so comparisons and saved permissions cannot leak
into subsequent tests. `just test-e2e` runs the browser suite; `just check` now
includes it. Auth overhaul and CORS/deployment are
intentionally outside the coverage scope. Chromium emulation is not a substitute
for occasional verification on a physical phone.

The GitHub release build does not run this credential-dependent suite. Run
`just check` locally before releasing; no provider credentials are copied into CI.

## Overrides

- `VOXPILOT_E2E_URL`: frontend URL (default `http://localhost:13000`).
- `VOXPILOT_E2E_API`: backend URL (default `http://127.0.0.1:8001`). Temporary
  repository paths must be accessible to it. Local HTTP URL overrides also let
  Playwright start the servers on different ports for startup verification.
- `VOXPILOT_E2E_CHROMIUM`: Chromium executable (default `/usr/bin/chromium`).
- `VOXPILOT_E2E_CDP`: attach to an existing browser. The runner reuses its context
  and only closes tabs it creates. Network, touch, and JavaScript-disabled tests
  use isolated local Chromium and are skipped in CDP mode.

Reports are in `test-results/` and `playwright-report/`.
`npm run typecheck` includes the E2E helpers and Playwright configuration.
