# Copilot CLI ACP Session Persistence — Findings

**Produced by:** Copilot coding agent  
**Date:** February 2026  
**Question:** Can `session/load` recover Copilot CLI ACP session state after a process restart, and what does this mean for VoxPilot's reconnect and persistence plan?

---

## Background: What Is Copilot CLI ACP?

GitHub Copilot CLI can be started as an **ACP (Agent Client Protocol) server** using the `--acp` flag:

```bash
# stdio mode (recommended for editor/tool integration)
copilot --acp --stdio

# TCP mode
copilot --acp --port 3000
```

ACP standardises bidirectional communication between any client (editor, custom frontend, CI/CD pipeline) and a coding agent. Messages are exchanged as NDJSON streams. The protocol defines a lifecycle:

1. **`initialize`** — client negotiates protocol version and discovers server capabilities (including whether `loadSession` is supported).
2. **`newSession`** — client asks the server to create a fresh session; server returns a `sessionId`.
3. **`session/load`** — client asks the server to restore a previously persisted session by `sessionId`.
4. **`prompt`** — client sends a user message; server streams back agent responses and tool events.

The TypeScript SDK (`@agentclientprotocol/sdk`) wraps these calls as `connection.initialize(…)`, `connection.newSession(…)`, and so on.

---

## Session Management in Interactive (non-ACP) Mode

In the default interactive CLI, Copilot stores session state under `~/.copilot/session-state` (v0.0.342+, replaces the legacy `~/.copilot/history-session-state`). This lets users resume previous sessions with:

```bash
copilot --resume    # interactive picker of previous sessions
copilot --continue  # auto-resume the most recent session
```

This **does** work across process restarts in interactive mode — the session file survives the process exit.

---

## Definitive Finding: `session/load` Is NOT Supported in ACP Mode

When Copilot CLI is started with `--acp`, the `initialize` response explicitly declares:

```json
{
  "loadSession": false
}
```

This means the ACP server **does not implement the `session/load` endpoint**. Sending a `session/load` request in ACP mode is unsupported. This is tracked as an open feature request in the Copilot CLI issue tracker (issue #936: *"Support session/load in ACP Mode"*).

**Answer to the core question:** No — `session/load` **cannot** be used to recover Copilot CLI ACP session state after a process restart. The only ACP session primitive available today is `newSession`; every restart of the `copilot --acp` process requires creating a brand-new session with no persistent context carried over from the previous process.

---

## Capability Matrix

| Capability | Interactive CLI | ACP Mode |
|---|---|---|
| Create new session | ✅ | ✅ (`newSession`) |
| Resume previous session | ✅ (`--resume`, `--continue`) | ❌ (`loadSession: false`) |
| Persist context across process restart | ✅ (file-backed) | ❌ |
| Stream agent responses | ✅ | ✅ (`prompt`) |
| Tool calls / confirmation | ✅ | ✅ (`requestPermission`) |

---

## Implications for VoxPilot's Reconnect and Persistence Plan

### Current VoxPilot Architecture (Self-Contained LLM Proxy)

VoxPilot currently acts as its own LLM proxy (via the GitHub Models API), not as an ACP client of Copilot CLI. Session persistence is **already solved correctly** at the VoxPilot layer:

- All messages (user, assistant, tool call, tool result) are persisted in SQLite immediately as they arrive.
- When a browser reconnects, `GET /api/sessions/{id}/stream` replays the full message history from SQLite before emitting `ready`, so the client reconstitutes its state with no gaps.
- VoxPilot's in-memory `SessionStreamRegistry` is ephemeral and is transparently recreated on reconnect.

This pattern is **correct and complete** for VoxPilot's current architecture. No changes are needed for the current self-hosted LLM proxy mode.

### Future Scenario: VoxPilot as an ACP Client of Copilot CLI

If VoxPilot were to add a Copilot CLI backend (using `copilot --acp` as the inference engine instead of GitHub Models), the `session/load` limitation has a direct consequence:

**VoxPilot, not Copilot CLI, must own session persistence.**

Concretely:

1. **Each Copilot CLI process lifecycle is stateless from an ACP perspective.** When the `copilot --acp` child process is (re)started, VoxPilot must call `newSession` to get a fresh ACP session. There is no `loadSession` to call.

2. **History injection is VoxPilot's responsibility.** To give the new Copilot CLI process the conversation context from a prior session, VoxPilot would need to reconstruct the history from its SQLite store and re-inject it into the new ACP session (e.g., as a system prompt prefix or a series of synthetic `prompt` turns).

3. **VoxPilot's existing SQLite persistence is the right primitive.** The `messages` table already stores the full conversation, including tool calls and results. For a future ACP backend, the same table would serve as the authoritative state; the ACP `sessionId` would be a short-lived, process-scoped handle that VoxPilot tracks in memory (or in a new DB column) for the lifetime of the subprocess.

4. **The reconnect flow already works correctly for the browser↔VoxPilot leg.** The SSE `Last-Event-ID`-based reconnect and history replay in `GET /api/sessions/{id}/stream` is independent of the backend inference engine and requires no changes.

### Recommended Architecture for a Future ACP Backend

```
Browser ─SSE/POST──► VoxPilot (Bun/Hono)
                          │
                          │  spawn on demand, restart if dead
                          ▼
                    copilot --acp --stdio   (short-lived process)
                          │
                          │  newSession() on each spawn
                          │  inject history from SQLite on first prompt
                          ▼
                    Copilot agent (in-process state, ephemeral)
```

- **VoxPilot persists everything** in SQLite — source of truth, survives any restart.
- **Copilot CLI process** is treated as a stateless inference engine; VoxPilot manages its lifecycle and context injection.
- **No reliance on `session/load`** — it is unavailable and should not be assumed to arrive in the near term.

### Concrete Changes Needed (When/If ACP Backend Is Added)

| What | Why |
|---|---|
| Add a `copilotSessionId` (nullable) column to the `sessions` table | Track the in-flight ACP session handle for the active subprocess |
| Spawn and restart the `copilot --acp` process in a service module | Lifecycle management, health detection |
| Implement history-injection logic | On each `newSession`, replay prior messages as context before forwarding new user prompt |
| No changes to the SSE stream or SQLite persistence layer | Those are already correct |

---

## Summary

`session/load` **cannot** be used to recover Copilot CLI ACP session state after a process restart — it is explicitly disabled (`"loadSession": false` in the `initialize` response, issue #936). The interactive CLI (`--resume`/`--continue`) supports session recovery, but that pathway is not accessible from the ACP protocol.

For VoxPilot's reconnect and persistence plan this means:

- **No action needed today** — VoxPilot's current SQLite + SSE replay pattern is correct and self-sufficient.
- **If a Copilot CLI ACP backend is added in the future**, VoxPilot must treat the Copilot CLI process as stateless, own all persistence in SQLite, and inject conversation history on every new ACP session. Do not assume `session/load` will become available.
