---
# Copilot CLI ACP Tool — Implementation Plan (UPDATED: Session Reconnect and Resilience)

## Overview (unchanged)

## Key Decisions (add new rows)
| Decision | Choice |
|---|---|
| ACP session reconnect | CopilotConnection survives disconnects, allows session/load replay on reconnect |
| History replay/streaming | On session/load, CopilotConnection replays all prior and live agent_message_chunk events as copilot-delta to clients |
| Connection lifecycle | CopilotConnection stored in a global singleton Map, outlives SSE broadcasters. TTL config for idle cleanup |
| Dangling tool call recovery | On reconnect, if copilot_agent tool call has no tool-result, backend resumes streaming Copilot output from session/load |

## Backend

### 2. Create `CopilotConnection` service (modification)
- Connections are stored in a `Map<string, CopilotConnection>` that survives SSE disconnects. Do not kill Copilot CLI child process on disconnect — keep alive until TTL expires or session ends.
- Add `loadSession(sessionId, workDir)`: calls ACP `session/load`, pipes resulting `session/update` (history + live) events as copilot-delta to fresh SSE clients.
- Check `agentCapabilities.loadSession` during initialization. If false, fallback to old approach.

### 5. Modify `runAgentLoop` (modification)
- Do *not* abort Copilot tool execution if isDisconnected fires during prompt — continue running `copilot_agent` tool even if no listeners remain. Only abort LLM streaming, not tools.
- If agent loop aborts during tool execution, persist a synthetic error or status message for tool call to DB, so conversation context remains valid.

### NEW: Session Reconnect Handler
- On reconnect, after history replay, check for dangling copilot_agent tool calls (tool call, no tool-result). If CopilotConnection still exists:
  - Call `loadSession()`
  - Pipe replayed agent_message_chunk events as copilot-delta SSE to the new client
  - Pipe live updates as they arrive
  - Persist final tool-result when prompt finishes
- Add optional frontend reconnection notification: "Recovered ongoing Copilot tool execution, replaying output..."

### 7. Update config (addition)
- Add `COPILOT_CONNECTION_TTL` — duration (in seconds/minutes) to keep orphaned CopilotConnections alive for possible reconnect before cleanup

## Frontend

### 13. Handle history + reconnect replay (modification)
- If CopilotStreamBlock is rendered for a currently executing copilot_agent (no tool-result in history), listen for fresh copilot-delta events streamed from backend
- Display an indicator (spinner/notice) that this is a recovered session and output is still live

## Verification (add checklist)
- [ ] Refresh browser mid-Copilot execution, verify reconnection produces history replay, then live streaming from session/load
- [ ] Multiple clients connect/disconnect from same session and receive live/replay Copilot output
- [ ] Idle CopilotConnections are cleaned up after TTL config
- [ ] Dangling copilot_agent tool call is recoverable: session remains valid, no orphaned child process
---
