# Copilot CLI ACP Tool — Implementation Plan

## Overview

Add a `copilot_agent` tool that the main AI can invoke to delegate coding tasks
to GitHub Copilot CLI via the Agent Client Protocol (ACP). The backend spawns a
long-lived `copilot --acp --stdio` child process per voxpilot session, manages
initialization/session setup, and streams Copilot's output back via new SSE
event types. The frontend renders these as expandable `<details>` blocks that
stream in real-time (expanded while running, auto-collapsed on completion) —
matching the VS Code subagent pattern.

## Key Decisions

| Decision | Choice |
|---|---|
| Tool input | Free-form prompt string — the main AI composes the prompt |
| Copilot permissions | Auto-approve all (`outcome: "allowed"`) |
| Process lifecycle | Long-lived per session — one `copilot --acp --stdio` process per voxpilot session, with **multiple ACP sessions** on that connection for independent tasks |
| Session model | Each tool invocation can reuse the current ACP session (follow-ups) or create a fresh one (new independent task) via the `new_session` parameter |
| Streaming UX | Expanded while streaming, auto-collapse on done |

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
- `prompt(text, onDelta, opts?)` → calls `connection.prompt(...)`, streams
  `agent_message_chunk` updates via the `onDelta` callback, returns
  `PromptResponse` with `stopReason`. If `opts.newSession` is true, calls
  `newSession()` first to get a fresh ACP session before prompting.
- `currentSessionId` — tracks the active ACP session ID. Callers can inspect
  this to know whether a session already exists.
- `destroy()` → kills the child process, cleans up all sessions.

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
  - `displayResult`: more detailed log.
  - The real UX comes from streaming SSE events emitted during execution (not
    from the result text).

### 5. Modify `runAgentLoop`

**File**: `backend/src/services/agent.ts`

Special-case `copilot_agent` in the tool execution block (similar to how diff
tools are special-cased for artifact creation):

1. Before calling `tool.execute()`, set up the ACP connection's `sessionUpdate`
   callback to yield `copilot-delta` events with the `tool_call_id`.
2. Capture `agent_message_chunk` updates where `content.type === "text"` and
   yield them as `copilot-delta` SSE events.
3. When `.prompt()` resolves, yield a `copilot-done` event with the stop reason.
4. The standard `tool-result` event still fires afterward with the summary.

Pass `sessionId` and `workDir` to the copilot tool via an extended context
parameter or by directly calling the copilot service from the agent loop.

### 6. Register the tool

**File**: `backend/src/tools/index.ts`

Add `CopilotAgentTool` to `buildDefaultRegistry()`.

### 7. Update config

**File**: `backend/src/config.ts`

Add `VOXPILOT_COPILOT_CLI_PATH` (default: "copilot") so users can override
the CLI binary path.

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
`CopilotStreamBlock` appearance but without streaming.

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
- [ ] Run existing tests (`bun test`) to ensure no regressions.