# VoxPilot — Copilot CLI ACP Integration Plan

This document describes how VoxPilot will integrate with the GitHub Copilot CLI via the Agent Communication Protocol (ACP). It covers the process lifecycle, session management, reconnection strategy, and resilience guidance derived from the investigation in `docs/copilot-acp-persistence-findings.md`.

---

## Background

GitHub Copilot CLI (`copilot --acp`) exposes an ACP (Agent Communication Protocol) endpoint over stdin/stdout using NDJSON (JSON-RPC 2.0). VoxPilot spawns this process as a child process and communicates with it to delegate coding-agent tasks to Copilot.

**ACP transport:** NDJSON over stdin/stdout (not a network socket). The `--stdio` flag exists in source but is not exposed in `--help`; `--acp` alone suffices.

**Protocol version:** `protocolVersion` must be the **number** `1` (not a string). Sending a string value returns a validation error.

Correct `initialize` request format:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"capabilities":{},"clientInfo":{"name":"voxpilot","version":"1.0"}}}
```

---

## Process Lifecycle

### Startup

1. Spawn `copilot --acp` as a child process.
2. Send `initialize` to establish the ACP session and discover capabilities.
3. Verify `agentCapabilities.loadSession: true` in the response before attempting any session restoration.
4. Send `authenticate` with a valid Copilot OAuth token (obtained via `copilot login` device flow).
5. Proceed to create (`session/new`) or restore (`session/load`) a session.

**`initialize` response — key capability flags:**

```json
{
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
  }
}
```

| Flag | Meaning |
|------|---------|
| `agentCapabilities.loadSession: true` | Server supports `session/load`; history replay after restart is available |
| `sessionCapabilities.list: {}` | `session/list` is supported (no auth required) |

### Normal Operation

- All ACP calls are sent over the child process's stdin; responses arrive on stdout.
- Save the `sessionId` returned by `session/new` immediately after it succeeds. This is the only handle needed to restore the session after a process restart.
- The session state is durably written to disk by the CLI in near-real-time (100 ms debounced flush). Do not treat the process as the sole source of truth.

### Shutdown

- On graceful shutdown, send `session/cancel` if a `session/prompt` is in progress, then terminate the child process.
- A clean shutdown causes the CLI to write a `session.shutdown` event to the session log, marking it cleanly closed.
- Ungraceful kills (SIGKILL, crash) may leave the most recent events (within the 100 ms flush window) un-flushed. The session remains loadable; only the very last events may be missing.

---

## Session Persistence

> **Sessions survive process restarts.**

The Copilot CLI persists all session state to disk as NDJSON event logs. These files are process-independent — the `copilot` process is not required for the session data to remain available.

**Storage location:**

```
~/.copilot/session-state/{sessionId}/events.jsonl   (current format)
~/.copilot/session-state/{sessionId}.jsonl          (legacy format, auto-imported)
```

The `--config-dir <directory>` flag overrides the base directory. In containerised or multi-user deployments, set this to a known, mounted path for predictable session recovery.

**What is persisted** (event categories written to disk):

| Category | Event Types |
|----------|-------------|
| Session lifecycle | `session.start`, `session.resume`, `session.shutdown`, `session.compaction_start/complete` |
| Conversation | `user.message`, `assistant.message`, `assistant.turn_start/end`, `system.message` |
| Tool execution | `tool.execution_start/progress/complete`, `skill.invoked` |
| State changes | `session.model_change`, `session.mode_changed`, `session.title_changed` |

---

## Reconnect and Resilience

### Reconnection Flow (After Process Restart)

When the `copilot --acp` process is killed or crashes, **full session history can be recovered** using the saved `sessionId`:

1. Spawn a fresh `copilot --acp` process.
2. Send `initialize` — confirm `agentCapabilities.loadSession: true`.
3. Send `authenticate` with a valid token.
4. Send `session/load` with the saved `sessionId`:
   ```json
   {"jsonrpc":"2.0","id":3,"method":"session/load","params":{"sessionId":"<saved-id>","cwd":"/path/to/project","mcpServers":[]}}
   ```
5. The CLI replays all events from `events.jsonl`, reconstructing the full in-memory session state.
6. Resume interaction — the conversation history, tool results, and file changes are fully restored.

> **Note:** `session/list` can be called **without authentication** to verify that the saved `sessionId` is still present on disk before attempting `session/load`.

---

> ### ⚠️ Auth Is Required for Session Restoration
>
> `session/load` requires a valid Copilot OAuth token — the same credential required by `session/new`. Reconnection will **fail with `{"code":-32000,"message":"Authentication required"}`** if:
>
> - The token has expired.
> - The user has not completed the `copilot login` OAuth device flow.
> - The provided token does not have Copilot API access (e.g., a plain `ghu_*` OAuth token without a Copilot subscription).
>
> **Mitigation:** Implement token refresh / re-authentication before every reconnection attempt. Store the token securely and check its validity before spawning the new process.

---

### Error Handling Matrix

| Error Condition | Response from CLI | Recommended Action |
|----------------|-------------------|--------------------|
| Token expired / missing | `{"code":-32000,"message":"Authentication required"}` | Refresh token → retry `authenticate` → retry `session/load` |
| Session file not found / corrupted | Non-auth error from `session/load` | Fall back to `session/new`; display "Session history lost" notice to user |
| Session file exists but incomplete (ungraceful kill) | `session/load` succeeds; last ≤100 ms of events missing | Resume normally; warn user that the last message may be incomplete |
| `session/list` shows no matching id | Empty sessions list | Skip `session/load`; fall back to `session/new` |

### User Experience When Session Cannot Be Restored

If `session/load` fails and fallback to `session/new` is required:

1. **Display a banner** in the chat UI: _"The previous Copilot session could not be restored. A new session has been started. Your conversation history in VoxPilot is intact."_
2. **Inject a synthetic system message** into the new Copilot session summarising the last user request (pulled from VoxPilot's own SQLite history), so the agent has context to continue.
3. **Do not replay the entire conversation** into the new session — Copilot has context-window limits. Summarise the task state from VoxPilot's stored messages instead.
4. **Log the failure** server-side with the `sessionId` and error code for diagnostics.

---

## ACP Method Reference

| Method | Auth Required | Notes |
|--------|--------------|-------|
| `initialize` | No | Must be first; returns `agentCapabilities` |
| `session/list` | **No** | Safe to call any time; use to check session existence |
| `authenticate` | No | Must precede any session operation |
| `session/new` | **Yes** | Returns `sessionId` — save immediately |
| `session/load` | **Yes** | Replays JSONL history; use after restart |
| `session/prompt` | Yes | Send a user turn |
| `session/cancel` | Yes | Cancel an in-progress prompt |
| `session/resume` | N/A | **Not a callable ACP method.** It is an internal event type written to the session log by the CLI during `session/load`. Calling it returns `"Method not found"`. |

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Save `sessionId` to VoxPilot's SQLite DB immediately after `session/new` | It is the only recovery handle; losing it means no restoration path |
| Call `session/list` before `session/load` on reconnect | Avoids an unnecessary auth round-trip when the session file is already gone |
| Store token securely and validate before reconnect | Auth errors are the #1 failure mode for session restoration |
| Use `--config-dir` in production deployments | Ensures session files are at a predictable, mounted path |
| Summarise task context via synthetic message on new session | Preserves agent context without replaying unbounded history |
