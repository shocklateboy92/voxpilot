# Copilot CLI ACP Session Persistence — Investigation Findings

**Date:** 2026-02-21  
**CLI Version:** GitHub Copilot CLI 0.0.413  
**Environment:** GitHub Actions runner (linux-x64, sandboxed)

---

## Summary

The GitHub Copilot CLI (`copilot --acp`) **does persist ACP session state to disk** as NDJSON event logs. Sessions survive process restarts and can be reloaded via `session/load`. Authentication is required for both creating and loading sessions.

---

## 1. Installation

The Copilot CLI is available via `gh copilot` (part of the GitHub CLI), which downloads the binary on first run:

```sh
# Trigger download (auto-confirms install prompt)
echo "Y" | gh copilot -- --version
# → GitHub Copilot CLI 0.0.413

# Binary installed at:
# ~/.local/share/gh/copilot/copilot
```

Alternatively, install `@anthropic-ai/claude-code` from npm for the `claude` binary (a separate tool, not the Copilot CLI).

**Note:** `--acp` is a flag on the `copilot` binary (not `claude`). The `--stdio` flag exists in the source but is not exposed in `--help`; ACP mode uses stdout by default.

---

## 2. ACP `initialize` Request and Response

**Request format** (NDJSON over stdin):
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
```

> **Important:** `protocolVersion` must be a **number** (`1`), not a string (`"2025-06-18"`). A string value returns a validation error.

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "loadSession": true,
      "promptCapabilities": {
        "image": true,
        "audio": false,
        "embeddedContext": true
      },
      "sessionCapabilities": {
        "list": {}
      }
    },
    "agentInfo": {
      "name": "Copilot",
      "title": "Copilot",
      "version": "0.0.413"
    },
    "authMethods": [
      {
        "id": "copilot-login",
        "name": "Log in with Copilot CLI",
        "description": "Run `copilot login` in the terminal",
        "_meta": {
          "terminal-auth": {
            "command": "/home/runner/.local/share/gh/copilot/copilot",
            "args": ["login"],
            "label": "Copilot Login"
          }
        }
      }
    ]
  }
}
```

**Key capability flags:**
- `agentCapabilities.loadSession: true` — the server explicitly advertises session loading support
- `sessionCapabilities.list: {}` — session listing is supported

---

## 3. ACP Method Inventory (Tested)

| Method | Auth Required | Result |
|---|---|---|
| `initialize` | No | Returns capabilities (see above) |
| `session/list` | **No** | Returns `{"sessions": []}` when empty |
| `session/new` | Yes | `{"code":-32000,"message":"Authentication required"}` without auth |
| `session/load` | Yes | `{"code":-32000,"message":"Authentication required"}` without auth |
| `authenticate` | No | Returns `{}` (acknowledges, but does not actually grant auth with `ghu_*` tokens) |
| `session/resume` | N/A | `{"code":-32601,"message":"\"Method not found\": session/resume"}` — **not an ACP method** |
| `session/fork` | N/A | `{"code":-32601,"message":"\"Method not found\": session/fork"}` — not an ACP method |
| `ping` | N/A | `{"code":-32601,"message":"\"Method not found\": ping"}` — not an ACP method |
| `models.list` | N/A | `{"code":-32601,"message":"\"Method not found\": models.list"}` — not an ACP method |

Additional methods confirmed in source code (not directly testable without auth): `session/prompt`, `session/cancel`, `session/update`, `session/set_config_option`, `session/set_mode`, `session/set_model`, `session/request_permission`.

---

## 4. Authentication

The sandbox runner's `GITHUB_TOKEN` (`ghu_*` OAuth token) does **not** grant Copilot API access. The `authenticate` ACP method accepts the call but does not resolve auth for subsequent `session/new` or `session/load` calls.

Full end-to-end session testing (create → kill → restart → load) requires a valid GitHub Copilot subscription with a properly scoped OAuth token obtained via `copilot login` (OAuth device flow).

---

## 5. Session Persistence Mechanism (Source Analysis)

Despite the authentication limitation blocking live testing, the session storage mechanism is fully documented in the CLI source code at `~/.copilot/pkg/linux-x64/0.0.413/index.js`.

### Storage Location

Sessions are stored under the **configDir state directory**:

```
Default configDir: ~/.copilot  (or $XDG_STATE_HOME/.copilot if set)

Session files:
  New format (current):   ~/.copilot/session-state/{sessionId}/events.jsonl
  Legacy format (older):  ~/.copilot/session-state/{sessionId}.jsonl
```

The path is determined by:
```javascript
function AI(settings, type) {
  if (settings?.configDir) return settings.configDir;
  const xdg = type === "config" ? process.env.XDG_CONFIG_HOME : process.env.XDG_STATE_HOME;
  return xdg ? path.join(xdg, ".copilot") : path.join(os.homedir(), ".copilot");
}

function getSessionDir(settings) {
  return path.join(AI(settings, "state"), "session-state");
}
// → ~/.copilot/session-state/
```

The `--config-dir <directory>` CLI flag overrides the base config directory, allowing sessions to be stored in a custom location.

### File Format

Session files are **NDJSON event logs** (one JSON object per line). Each event conforms to a rich event schema (`~/.copilot/pkg/linux-x64/0.0.413/schemas/session-events.schema.json`).

**Session event types include:**

| Category | Event Types |
|---|---|
| Session lifecycle | `session.start`, `session.resume`, `session.shutdown`, `session.compaction_start`, `session.compaction_complete`, `session.snapshot_rewind` |
| Conversation | `user.message`, `assistant.message`, `assistant.message_delta`, `assistant.turn_start`, `assistant.turn_end`, `system.message` |
| Tool execution | `tool.execution_start`, `tool.execution_progress`, `tool.execution_partial_result`, `tool.execution_complete`, `skill.invoked` |
| State changes | `session.model_change`, `session.mode_changed`, `session.title_changed`, `session.context_changed`, `session.plan_changed` |
| Legacy/import | `session.import_legacy` |

### Session Loading Logic

When `session/load` is called with a `sessionId`:

1. The CLI reads `~/.copilot/session-state/{sessionId}/events.jsonl` (or `.jsonl` legacy fallback)
2. All events are replayed to reconstruct in-memory session state (filtering out `assistant.reasoning` events for efficiency)
3. A `session.resume` event is emitted with the current context (`cwd`, git info, event count, resume timestamp)
4. Session history (messages, tool results, files changed, etc.) is fully restored

The `session.resume` event is an **internal event type** written to the session log — it is not an ACP method. The ACP method to restore a session is `session/load`.

### Session Listing

`session/list` scans the `~/.copilot/session-state/` directory for `.jsonl` files and directories containing `events.jsonl`. It returns sessions sorted by last-modified time. This method does **not** require authentication, enabling host applications to discover available sessions without a live Copilot auth context.

### Session Index (Optional)

A feature-flagged SQLite session store (`SESSION_STORE`) can be enabled for faster session discovery, tracking sessions with `cwd`, `repository`, `branch`, and `summary` metadata. When enabled, sessions are indexed into a local SQLite database in addition to the JSONL files.

---

## 6. Conclusions: Session Persistence Across Restarts

Based on source code analysis and protocol testing:

| Question | Answer |
|---|---|
| Are sessions persisted to disk? | **Yes** — NDJSON event logs in `~/.copilot/session-state/` |
| Do sessions survive process restarts? | **Yes** — the JSONL files are process-independent |
| Is `session/load` supported? | **Yes** — confirmed in source and tested (returns auth error without credentials, not "method not found") |
| Does `session/load` replay history? | **Yes** — reconstructs full session state from events |
| Is `session/resume` an ACP method? | **No** — it is an internal event type emitted during session loading |
| Is auth required for `session/load`? | **Yes** — same auth requirement as `session/new` |
| Can you list sessions without auth? | **Yes** — `session/list` requires no authentication |

---

## 7. Recommendations for `COPILOT_TOOL_PLAN.md` Resilience Strategy

### Reconnection Flow

After a Copilot CLI process restart, the reconnection strategy should be:

1. **Spawn new `copilot --acp` process**
2. **Send `initialize`** — verify `agentCapabilities.loadSession: true`
3. **Send `authenticate`** — provide valid token before attempting session operations
4. **Send `session/load`** with the saved `sessionId` — this restores full session history
5. **Resume interaction** — the session context is fully restored

### Key Design Implications

- **Save `sessionId` immediately** after `session/new` succeeds. It is the only recovery handle.
- **`session/list` is safe to call without auth** — use it to check if a stored sessionId is still present on disk before attempting `session/load`.
- **Auth is required for `session/load`** — reconnection will fail if the auth token is invalid or expired. Implement auth refresh logic before reconnection attempts.
- **Session files are durable** — they are written by the `SessionWriter` with debounced flushing (default 100ms). A clean shutdown writes a `session.shutdown` event. Ungraceful kills may leave the last events un-flushed (within the 100ms window), but the session remains loadable.
- **The `--config-dir` flag** allows controlling where sessions are stored. In multi-user or containerized deployments, set this to a known path for reliable reconnection.
- **Legacy format fallback** — if the primary `.jsonl` file is not found, the CLI automatically checks for the legacy `{sessionId}.jsonl` format and imports it via a `session.import_legacy` event.

### Error Handling

- If `session/load` returns `{"code":-32000,"message":"Authentication required"}` → refresh auth and retry
- If `session/load` returns a session-not-found or corruption error → fall back to `session/new` and notify the user that history was lost
- Use `session/list` proactively to verify session existence before attempting `session/load`

---

## Appendix: Test Commands

```sh
COPILOT=~/.local/share/gh/copilot/copilot

# Initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  | $COPILOT --acp

# List sessions (no auth required)
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","id":2,"method":"session/list","params":{}}'
  sleep 1
) | $COPILOT --acp

# Authenticate (replace TOKEN with valid Copilot OAuth token)
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","id":2,"method":"authenticate","params":{"methodId":"copilot-login","token":"TOKEN"}}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","id":3,"method":"session/new","params":{"cwd":"/path/to/project","mcpServers":[]}}'
  sleep 5
) | $COPILOT --acp

# Load existing session (requires auth)
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","id":2,"method":"authenticate","params":{"methodId":"copilot-login","token":"TOKEN"}}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","id":3,"method":"session/load","params":{"sessionId":"SAVED_SESSION_ID","cwd":"/path/to/project","mcpServers":[]}}'
  sleep 5
) | $COPILOT --acp
```
