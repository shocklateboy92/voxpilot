# VoxPilot — Coding Agent Roadmap

## From Chatbot to Coding Agent

VoxPilot is currently a **chat proxy** — it relays messages to a model and displays the response. A coding agent needs three things on top of that:

1. **Tools** the LLM can call (read files, edit, run commands)
2. **An agentic loop** that executes tools and feeds results back to the LLM until the task is done
3. **Streaming** so the user sees progress during multi-step agent runs (which can take 30+ seconds)

The OpenAI SDK already supports tool-calling, so the LLM-side protocol is handled by the SDK we already use.

## MVP: Phases 1–4

```
Phase 1: Streaming ──► Phase 2: Read tools + agentic loop ──► Phase 3: Write tools ──► Phase 4: Shell
         (foundation)         (agent, not chatbot)               (agent that codes)       (agent that verifies)
```

After Phase 4, VoxPilot is a **functional coding agent** you can use from your phone: it can read your codebase, make changes, run tests, and iterate on failures.

---

## Phase 1: Streaming Chat ✅

**Status:** Complete.

**What was built:**

- Session-scoped SSE stream: `GET /api/sessions/{id}/stream` opens a persistent `EventSource` connection that replays message history on connect, then delivers live events
- Separate message submission: `POST /api/sessions/{id}/messages` enqueues a user message (returns 202); all events flow through the SSE stream
- In-memory `asyncio.Queue` per session (`services/streams.py`) bridges POST → SSE generator
- SSE event protocol: `message` (history + echo), `ready`, `text-delta`, `done`, `error` — all JSON payloads
- Frontend uses browser-native `EventSource` (no custom SSE parser)
- Future phases will add `tool-call` and `tool-result` event types

---

## Phase 2: Tool Framework + Read-Only Tools ✅

**Status:** Complete.

**What was built:**

- Tool framework: abstract `Tool` base class (`services/tools/base.py`), `ToolRegistry` (`services/tools/registry.py`), path traversal guards via `resolve()` + `relative_to()`
- 4 read-only tools: `read_file` (line ranges, 100KB limit), `list_directory` (noise-dir filtering, dirs-first), `grep_search` (regex, include globs, 200-match cap), `glob_search` (recursive, 500-result cap)
- Agentic loop (`services/agent.py`): streaming LLM → detect tool calls → execute → feed results back → repeat until text response or 25-iteration safety cap. Errors are returned to the LLM (not the user) so it can self-correct.
- SSE event protocol extended: `tool-call` and `tool-result` events alongside existing `text-delta`/`done`/`error`
- DB schema extended: `tool_calls` (JSON) and `tool_call_id` columns on messages table
- Frontend: collapsible `<details>` blocks for tool calls/results, history replay on reconnect
- `requires_confirmation: bool` hook on Tool base class (forward-looking for Phase 3 write tools)
- Config: `work_dir` (Path, defaults to cwd) and `max_agent_iterations` (int, default 25)

---

## Phase 3: Write Tools

**Why next:** This is the leap from "assistant that reads" to "agent that codes." Smallest possible delta to enable real work.

**What to build:**

- **Tools:** `write_file` (create/overwrite), `edit_file` (surgical string replacement)
- Frontend: show diffs for file changes (inline unified diff view)
- Consider a confirmation step before writes (toggleable)

**Useful after this phase:** "Fix the type error in auth.py", "Add a health check test", "Update the README with the new API endpoints." Practical from a tablet.

---

## Phase 4: Shell Execution

**Why next:** This closes the agent loop — the agent can now **verify its own work** by running tests, linters, and build commands. This is the single highest-leverage capability (per both Copilot and Claude Code docs).

**What to build:**

- **Tool:** `run_command` — execute shell commands, capture stdout/stderr, return to LLM
- Timeout and output-size limits (prevent runaway processes)
- Frontend: render command output in a terminal-styled block
- Allow the LLM to chain: edit file → run tests → fix failures → re-run

**Useful after this phase:** Full agent loop. "Implement feature X and make sure the tests pass." This is the **MVP coding agent**.

---

## Phase 5: Session Persistence + History ✅

**Status:** Complete.

**What was built:**

- SQLite-backed conversation history (sessions + messages tables)
- Session list in the UI with create, switch, delete
- Resume sessions across page reloads and devices
- Auto-title sessions from first user message (first 50 chars)
- History replayed via the session SSE stream on connect (no separate REST fetch needed)

---

## Phase 6: Project Context (Custom Instructions)

**Why next:** The agent is functional but doesn't know your conventions. Custom instructions are high-leverage — one file makes every future session better.

**What to build:**

- Load a `VOXPILOT.md` (or `.voxpilot/instructions.md`) from the project root
- Inject contents into the system prompt
- Support `@file` references to pull in additional context
- UI indicator showing which project/directory is active

**Useful after this phase:** "Always run `just check` after edits", "Use pytest-asyncio, not unittest", "This is a FastAPI project using src layout" — all automatic.

---

## Phase 7: Git Integration

**Why next:** Commit, branch, and push without a terminal. Particularly valuable for the mobile use case.

**What to build:**

- **Tools:** `git_status`, `git_diff`, `git_commit`, `git_branch`, `git_log`
- Or: just let the agent use shell commands from Phase 4 (simpler — `git` is already a CLI tool)
- Frontend: consider a dedicated git status panel (optional, could just be chat-driven)

**Useful after this phase:** "Commit these changes with a descriptive message and push." Full cycle from phone.

---

## Future Phases (Post-MVP)

| Phase | Feature | Value |
|---|---|---|
| 8 | **Multi-project / directory picker** | Work on different repos without restarting |
| 9 | **Subagents** | Delegate research to a separate context so main conversation stays clean |
| 10 | **MCP support** | Extensibility with external tools (databases, issue trackers, etc.) |
| 11 | **Hooks** | Deterministic actions: auto-lint after edit, auto-test after write |
| 12 | **Background tasks** | Kick off a long-running agent task and check back later (async agents) |

---

## Competitive Landscape Reference

Both GitHub Copilot coding agent and Claude Code converge on a similar core architecture:

1. An **agentic loop** that plans, executes tools (file read/write, shell, search), and self-corrects
2. **Custom instructions** (`.md` files) for per-repo context
3. **MCP** for extensibility with external tools
4. **Subagents/custom agents** for specialized tasks
5. **Hooks** for deterministic actions at key points

**Differentiators:**

- **Copilot's strength:** Deep GitHub integration (issues → PR → review cycle, security scanning, Actions-powered sandbox)
- **Claude Code's strength:** Local-first, CLI-driven with rich interactive controls (plan mode, checkpointing/rewind, context compaction, headless scripting)
- **VoxPilot's unique angle:** Web UI accessible from mobile — neither tool prioritizes this
