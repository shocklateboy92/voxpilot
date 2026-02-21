# Copilot CLI ACP Tool — Implementation Plan

## Overview

Add a `copilot_agent` tool that the main AI can invoke to delegate coding tasks
to GitHub Copilot CLI via the Agent Client Protocol (ACP). The backend spawns a
long-lived `copilot --acp --stdio` child process per voxpilot session, manages
initialization/session setup, and streams Copilot's output back via new SSE
event types. The frontend renders these as expandable `<details>` blocks that
stream in real-time (expanded while running, auto-collapsed on completion) —
matching the VS Code subagent pattern.

Copilot's ACP sessions are persisted on disk (`~/.copilot/session-state/`) and
can be replayed via `session/load`, giving us full reconnection support across
browser refreshes and backend restarts without custom buffering.

## Key Decisions

| Decision | Choice |
|---|---|
| Tool input | Free-form prompt string — the main AI composes the prompt |
| Copilot permissions | Auto-approve all (`outcome: "allowed"`) |
| Process lifecycle | Long-lived per session — one `copilot --acp --stdio` process per voxpilot session, with **multiple ACP sessions** on that connection for independent tasks |
| Session model | Each tool invocation can reuse the current ACP session (follow-ups) or create a fresh one (new independent task) via the `new_session` parameter |
| Streaming UX | Expanded while streaming, auto-collapse on done |
| Reconnection | ACP `session/load` replays full conversation; backend buffers per-tool-call output for mid-stream SSE reconnects |

## Backend

### 1. Add `@agentclientprotocol/sdk` dependency

Add to `backend/package.json`. This is the official ACP TypeScript SDK for
communicating with the Copilot CLI over stdin/stdout NDJSON.

### 2. Create `CopilotConnection` service

**File**: `backend/src/services/copilot-acp.ts`

Manages a per-voxpilot-session ACP connection lifecycle (lazy-initialized on
first tool call). A single child process hosts multiple ACP sessions, allowing
the main AI to start independent coding tasks without spawning new processes.

- `getOrCreate(sessionId, workDir)` — spawns `copilot --acp --stdio` via
  `Bun.spawn`, wraps stdin/stdout with `acp.ndJsonStream()`, creates a
  `ClientSideConnection`.
- The `Client` implementation:
  - `requestPermission()` → always returns `{ outcome: { outcome: "allowed" } }`
    (auto-approve).
  - `sessionUpdate()` → emits streaming chunks via a callback so the agent loop
    can yield SSE events.
- `initialize()` → calls `connection.initialize(...)`.
- `newSession()` → calls `connection.newSession({ cwd: workDir, mcpServers: [] })`,
  stores the ACP `sessionId`. Can be called multiple times on the same
  connection to create independent task contexts.
- `loadSession(acpSessionId, workDir)` → calls `connection.loadSession({ sessionId, cwd, mcpServers: [] })`.
  Replays the full conversation history via `session/update` notifications.
  Returns the accumulated output text so the caller can use it for display.
- `prompt(text, onDelta, opts?)` → calls `connection.prompt(...)`, streams
  `agent_message_chunk` updates via the `onDelta` callback, returns
  `PromptResponse` with `stopReason`. If `opts.newSession` is true, calls
  `newSession()` first to get a fresh ACP session before prompting.
- `currentSessionId` — tracks the active ACP session ID. Callers can inspect
  this to know whether a session already exists.
- `destroy()` → kills the child process, cleans up all sessions.
- `outputBuffer` — a `Map<string, string>` keyed by `tool_call_id`.
  Accumulates all `copilot-delta` text per tool call. Used to replay output on
  SSE reconnect (browser refresh while Copilot is mid-stream). Cleared when
  the tool call completes and the result is persisted to the DB.

Store connections in a `Map<string, CopilotConnection>` singleton, keyed by
voxpilot session ID. Clean up on session broadcaster shutdown.

#### Multi-session flow

```
voxpilot session
  └── CopilotConnection (one child process)
        ├── ACP Session A  ← first copilot_agent call (implicit newSession)
        │     ├── prompt 1  "fix the auth bug"
        │     └── prompt 2  "also add a test for it"  (follow-up, same session)
        └── ACP Session B  ← copilot_agent call with new_session: true
              └── prompt 3  "refactor the logger"     (independent task)
```

The first `copilot_agent` invocation always creates an ACP session. Subsequent
calls reuse it by default (for follow-up instructions). When the main AI
determines the task is unrelated, it sets `new_session: true` to start a fresh
ACP session on the same underlying connection/process.

#### Reconnection flows

**Browser refresh (backend still running):**

The `CopilotConnection` and child process are still alive. If Copilot is
mid-prompt, deltas continue flowing. The SSE reconnect handler (step 5b)
replays `outputBuffer` contents for any in-progress `copilot_agent` tool call,
then the new SSE listener receives live deltas going forward.

```
Browser refreshes
  → new EventSource connects
  → backend replays DB messages (existing flow)
  → backend checks CopilotConnection.outputBuffer for in-flight tool calls
  → emits buffered copilot-delta events to catch up the client
  → new listener receives live copilot-delta events from the ongoing prompt
```

**Backend restart (process dies and restarts):**

The child `copilot` process dies with the backend. On restart, when Copilot is
needed again, `getOrCreate()` spawns a fresh process. If a previous ACP session
ID is stored in the DB, `loadSession()` replays the full conversation via
`session/update` notifications, restoring context for follow-up prompts.

Completed `copilot_agent` tool calls already have their output persisted in the
DB as the tool result message's `displayResult` — the frontend renders these
from history as collapsed blocks (step 13). No ACP replay is needed for display
of completed calls.

In-flight `copilot_agent` calls that were interrupted by a backend crash are
lost — the tool result never completed, so the main AI's agent loop was also
interrupted. On reconnect, the frontend sees the incomplete assistant message
(same as any interrupted agent loop today). The user can re-send the request.

```
Backend restarts
  → new SSE connection, history replayed from DB
  → completed copilot_agent calls rendered from tool result messages
  → interrupted copilot_agent calls shown as incomplete (error state)
  → next copilot_agent call: getOrCreate() spawns new process
  → loadSession() restores ACP context from stored sessionId
  → follow-up prompts work as if nothing happened
```

### 3. Add new SSE event schemas

**File**: `backend/src/schemas/events.ts`

| Event | Schema | Purpose |
|---|---|---|
| `copilot-delta` | `{ tool_call_id: string, content: string }` | Streaming text chunks from Copilot |
| `copilot-done` | `{ tool_call_id: string, summary: string, stop_reason: string }` | Signals completion with summary |

### 4. Create `CopilotAgentTool`

**File**: `backend/src/tools/copilot-agent.ts`

- Implements `Tool` interface.
- `requiresConfirmation = false` — the main AI decides when to invoke it.
- `definition`:
  - name: `copilot_agent`
  - description: "Delegate a coding task to GitHub Copilot. Copilot will
    autonomously modify files in the workspace. Set `new_session` to true when
    starting an unrelated task (creates a fresh context); omit or set false for
    follow-up instructions to the current task."
  - parameters:
    - `prompt: string` (required) — the instruction to send to Copilot.
    - `new_session: boolean` (optional, default `false`) — when true, creates a
      new ACP session for this task instead of continuing the current one. The
      main AI should set this when the user asks for an independent/unrelated
      coding task.
- `execute()` returns a `ToolResult` after Copilot finishes:
  - `llmResult`: compact summary of what Copilot did.
  - `displayResult`: full accumulated Copilot output (from `outputBuffer`).
    This is persisted to the DB as part of the tool result message, making it
    available for history replay without needing ACP.
  - The real UX comes from streaming SSE events emitted during execution (not
    from the result text).

### 5. Modify `runAgentLoop`

**File**: `backend/src/services/agent.ts`

Special-case `copilot_agent` in the tool execution block (similar to how diff
tools are special-cased for artifact creation):

1. Before calling `tool.execute()`, set up the ACP connection's `sessionUpdate`
   callback to yield `copilot-delta` events with the `tool_call_id`.
2. Capture `agent_message_chunk` updates where `content.type === "text"` and
   yield them as `copilot-delta` SSE events. Also append to
   `CopilotConnection.outputBuffer[tool_call_id]`.
3. When `.prompt()` resolves, yield a `copilot-done` event with the stop reason.
4. The standard `tool-result` event still fires afterward with the summary.
5. Clear `outputBuffer[tool_call_id]` after the tool result is persisted.

Pass `sessionId` and `workDir` to the copilot tool via an extended context
parameter or by directly calling the copilot service from the agent loop.

### 5b. Replay Copilot state on SSE reconnect

**File**: `backend/src/routes/chat.ts`

In the SSE connection handler (after replaying DB messages and artifacts, before
emitting `ready`), check if the `CopilotConnection` for this session has any
active entries in `outputBuffer`. If so, emit the buffered content as
`copilot-delta` events so the reconnecting client catches up to the live stream.

This slots into the existing reconnection flow:

```
1. Replay persisted messages from DB       (existing)
2. Replay artifact summaries               (existing)
3. Replay in-flight copilot output buffer  (NEW)
4. Emit "ready" event                      (existing)
5. Relay live events from broadcaster      (existing)
```

### 6. Register the tool

**File**: `backend/src/tools/index.ts`

Add `CopilotAgentTool` to `buildDefaultRegistry()`.

### 7. Update config

**File**: `backend/src/config.ts`

Add `VOXPILOT_COPILOT_CLI_PATH` (default: "copilot") so users can override
the CLI binary path.

### 7b. Persist ACP session IDs

**File**: `backend/src/schema.ts`

Add an `acpSessionId` column to the `sessions` table (nullable text). When
`CopilotConnection.newSession()` creates an ACP session, persist the returned
`sessionId` to this column. On backend restart, `getOrCreate()` reads this to
decide whether to call `loadSession()` vs `newSession()`.

This also enables the `copilot_agent` tool to check whether a previous ACP
session exists without the `CopilotConnection` being live in memory.

**Migration**: `ALTER TABLE sessions ADD COLUMN acp_session_id TEXT;`

## Frontend

### 8. Extend store types

**File**: `frontend/src/store.ts`

Extend `StreamingToolCall`:

```typescript
export interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  isError?: boolean;
  artifactId?: string;
  copilotStream?: string;   // accumulated Copilot output text
  copilotDone?: boolean;     // true when Copilot finishes
}
```

### 9. Add SSE handlers

**Files**: `frontend/src/streaming.ts`, `frontend/src/sse.ts`

- `onCopilotDelta(data)`: find matching tool call in `streamingToolCalls` by
  `tool_call_id`, append `data.content` to its `copilotStream` field.
  Works identically for live deltas and replayed buffer content — the frontend
  doesn't need to distinguish them.
- `onCopilotDone(data)`: update matching tool call's `copilotDone = true`, set
  summary.
- Register these new event listeners via `addJsonEventListener`.

### 10. Create `CopilotStreamBlock` component

**File**: `frontend/src/components/CopilotStreamBlock.tsx`

- Renders inside `ToolCallBlock` when the tool is `copilot_agent`.
- Uses `<details class="copilot-block">` with `open` attribute bound to
  `!copilotDone`.
- `<summary>`: shows "🤖 Copilot" + spinner while running, or
  "🤖 Copilot — done" when finished.
- Body: renders the streaming `copilotStream` text in a `<pre>` with
  auto-scroll.
- When `copilotDone` becomes true, removes the `open` attribute (auto-collapses).
  The user can re-expand to see the full output.

### 11. Update `ToolCallBlock`

**File**: `frontend/src/components/ToolCallBlock.tsx`

When `props.call.name === "copilot_agent"`, render `<CopilotStreamBlock>`
instead of the standard arguments/result display. The outer `<details>` still
shows "⚙ copilot_agent" in the summary, but the inner content is the streaming
Copilot output instead of JSON args + result pre.

### 12. Add CSS styles

**File**: `frontend/src/style.css`

- `.copilot-block` — similar to `.tool-block` but with a distinct accent color
  (Copilot blue/purple).
- `.copilot-stream` — monospace pre output area with max-height, overflow-y
  auto, auto-scroll-to-bottom behavior.
- Transition/animation for collapse on completion.

### 13. Handle history replay

**File**: `frontend/src/components/MessageBubble.tsx`

When rendering a historical tool result for `copilot_agent`, show it as a
collapsed `<details>` with the summary and the full output inside — matching the
`CopilotStreamBlock` appearance but without streaming. The full output comes
from the tool result message's `displayResult` field, which was persisted to the
DB when the tool completed (no ACP replay needed for this case).

## Verification

- [ ] Start the backend with `copilot` CLI installed and authenticated.
- [ ] Send a chat message asking the AI to make a code change based on a review
      comment.
- [ ] Verify the main AI invokes `copilot_agent` with an appropriate prompt.
- [ ] Verify streaming events appear in the SSE stream (`copilot-delta`,
      `copilot-done`).
- [ ] Verify the frontend shows the expanding/collapsing Copilot output block.
- [ ] Verify the block auto-collapses when Copilot finishes.
- [ ] Verify the summary is returned to the main AI for further conversation.
- [ ] Verify history replay shows collapsed Copilot blocks correctly.
- [ ] Verify multiple ACP sessions work: a follow-up prompt reuses the session,
      and `new_session: true` creates a fresh one.
- [ ] Verify the process is reused across sessions (only one `copilot` child
      process per voxpilot session).
- [ ] **Browser refresh mid-stream**: refresh while Copilot is running, verify
      the reconnected client catches up (buffered output replayed, then live
      deltas resume).
- [ ] **Browser refresh after completion**: refresh after Copilot finishes,
      verify the completed block renders correctly from history.
- [ ] **Backend restart recovery**: kill and restart the backend, verify
      completed copilot blocks still display from DB history, and a follow-up
      `copilot_agent` call restores the ACP session via `session/load` before
      prompting.
- [ ] Run existing tests (`bun test`) to ensure no regressions.