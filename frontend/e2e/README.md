# Browser Baseline

These tests compare observable OpenCode 1.x behavior with the OpenCode 2.0
port. They use the real VoxPilot UI, backend, proxy, OpenCode server, and MCP
server. Only the model provider is deterministic; no transport code is mocked
and no application refactoring is required.

## Run Locally

From `frontend`, start the disposable server:

```sh
npm run test:e2e:serve
```

Set `VOXPILOT_E2E_OC_BINARY` to a native OpenCode 2.x executable. On this
workspace the harness defaults to the isolated 2.0.22 binary under
`/tmp/opencode/voxpilot-oc-native-2.0.22/`; it never falls back to the production
binary on PATH. For Linux x64/glibc, install that test binary without replacing
the existing installation:

```sh
npm install --prefix /tmp/opencode/voxpilot-oc-native-2.0.22 --no-save --package-lock=false --no-audit --no-fund --ignore-scripts @opencode/cli-linux-x64-baseline@2.0.22
```

Once the harness prints `Ready`, run in another terminal:

```sh
VOXPILOT_E2E_FIXTURE=1 npm run test:e2e
```

The default URL is `http://sisko.home.lasath.com:13000`. Use
`VOXPILOT_E2E_URL=http://127.0.0.1:13000` on another machine. The runner launches
headless `/usr/bin/chromium`; override with `VOXPILOT_E2E_CHROMIUM` if needed.
Playwright does not need to download a browser.

The harness uses a temporary workspace, app database, HOME, and XDG directories
under `/tmp/opencode`. It disables inherited OpenCode settings/plugins, provider
credentials stored in the normal OpenCode data directory, automatic updates,
and desktop idle inhibition. Ctrl+C stops its subprocesses and removes the
temporary data. `VOXPILOT_E2E_KEEP_ARTIFACTS=1` preserves data for diagnosis.
The fixture provider listens on loopback only.

Default ports are frontend 13000, backend 18001, provider 18002, and an ephemeral
OpenCode port. The harness does not inherit production's `VOXPILOT_PORT` or Bun dotenv
files. Port overrides are `VOXPILOT_E2E_PORT`, `VOXPILOT_E2E_BACKEND_PORT`,
and `VOXPILOT_E2E_PROVIDER_PORT`. Mutating tests deliberately
require a local HTTP URL on port 13000; changing that guard is an explicit action.

## Production Checks

Only the read-only suite should target production:

```sh
VOXPILOT_E2E_URL=https://voxpilot-dev2.apps.lasath.com npm run test:e2e -- smoke.spec.ts
```

It checks mobile/desktop loading, session-picker navigation, horizontal overflow,
and invalid session URL recovery. It does not submit prompts or modify sessions.
Assertions use DOM roles/text and existing CSS classes, not minified code names.

To reuse the existing logged-in Chromium context instead of launching headless:

```sh
VOXPILOT_E2E_CDP=https://cdp.apps.lasath.com VOXPILOT_E2E_URL=https://voxpilot-dev2.apps.lasath.com npm run test:e2e -- smoke.spec.ts
```

CDP runs create and close dedicated tabs only. They do not clear shared storage,
close existing tabs, or toggle the shared browser's network state. A suspended
desktop/compositor can stop animation frames even when pages are reachable;
that was observed in the remote browser during baseline setup. Use local
headless Chromium for reliable animation and streaming assertions.

## Coverage And Results

Baseline verified against OpenCode **1.18.25**: **11 tests passed**.
The port passes those same 11 tests against **2.0.22**, plus a new worktree
creation/session/reload test: **12 tests passed**.
The read-only suite also passed all **3 tests** against the deployed production
URL. The new test files pass strict TypeScript and Biome checks.

The existing backend suite had **88 passed, 2 failed** because `ruff` is absent
in this environment; both failures are Python-formatting tests, unrelated to
the browser additions. No application code was changed to address them.

- Mobile and desktop loading and navigation.
- Session creation, incremental text before completion, markdown rendering.
- Transcript persistence after reload, whole-conversation fork, fork deletion.
- Cancel generation followed by another successful prompt.
- Pending question restoration after reload and accepting an option.
- Pending permission restoration after reload and allowing once.
- Explicit model selection and persistence.
- Reload during generation, with every numbered chunk present exactly once.
- Temporary offline interruption, followed by complete transcript reconciliation.
- Real MCP diff cache creation, diff card, and diff review rendering.

The offline test confirms a browser probe fails while offline, then restores
connectivity. Final transcript correctness is asserted; it does not prove
gap-free live deltas or automatic replay. Final history reload can repair gaps.

One initial run observed live text lose its starting prefix before completion;
the final transcript was repaired. The baseline therefore asserts that live
text appears, and separately checks exact final content. Prefix preservation
is not a claimed baseline guarantee. This matches the existing streaming
manager's ordering risks and should be revisited during the port.

Not yet covered: turn-specific forks, rejection/always-allow,
model variants, agent switching persistence, long-history pagination, HTTP error
presentation, or a full OpenCode process restart. The fixture creates a seed
commit only in its disposable repository, allowing real worktree operations.

Tests run serially. Reruns add sessions only to the disposable fixture store;
restart the harness for a clean dataset. Failure artifacts are under
`test-results/`, and the HTML report is under `playwright-report/` (both ignored).

## Reuse For V2

Keep the UI assertions and fixture prompt outcomes stable. Port the harness's
OpenCode configuration/tool argument mapping as needed alongside the app;
these are intentionally the version-specific boundaries. Run the same suite
against the port and compare final transcripts, approvals/forms, tool results,
and recovery behavior rather than internal endpoint names or event schemas.

V1 baseline is preserved at commit `be19411`. The current harness uses native
V2 configuration and tool names. Passing this suite establishes covered UI
behavior, not compatibility with every provider, plugin, or historical session.
