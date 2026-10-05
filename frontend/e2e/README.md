# Browser regression tests

The suite uses the actual static frontend, native OpenCode 2 server and bundled
VoxPilot plugin. Only the model provider is deterministic. OpenCode data, config,
credentials and repositories live under a disposable `/tmp/opencode` directory.

```sh
just install
just build-plugin
cd frontend
npm run test:e2e:serve
```

Once Ready is printed, run in another terminal:

```sh
cd frontend
VOXPILOT_E2E_URL=http://localhost:13000 VOXPILOT_E2E_API=http://localhost:18001 VOXPILOT_E2E_FIXTURE=1 npm run test:e2e
```

`VOXPILOT_E2E_API` exercises direct cross-origin requests, matching central Caddy
hosting. Omit it to use Vite's same-origin development proxy. The connection form
uses the fixture-only password `voxpilot-fixture`.

The harness starts Vite on 13000, OpenCode on 18001, and the fixture provider on
18002. It disables inherited OpenCode configuration and idle inhibition. Ctrl+C
stops only its own processes and removes temporary data. Set
`VOXPILOT_E2E_KEEP_ARTIFACTS=1` to preserve diagnostics.

Tests cover mobile layout, connection, sessions, SSE recovery, cancellation,
reload, model selection, forms, permissions, worktrees, native diff tool cards and
review RPC rendering. Mutating tests require `VOXPILOT_E2E_FIXTURE=1` and a local
URL on port 13000. Never point those tests at a real working server.

Local Chromium defaults to `/usr/bin/chromium`; override with
`VOXPILOT_E2E_CHROMIUM`. Set `VOXPILOT_E2E_CDP` to attach to an existing browser;
the runner reuses its context and only closes tabs it creates. Failure artifacts
are in `test-results/` and `playwright-report/`.
