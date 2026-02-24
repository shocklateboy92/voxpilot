# VoxPilot → OpenCode SDK Migration Plan

## Architecture

Single Bun process hosting both the OpenCode server (in-proc via `createOpencode()`) and a thin Hono layer for review-specific endpoints and static file serving. The SolidJS frontend talks to one origin and uses OpenCode SDK types directly — no adapter/translation layer.

```
┌─────────────────────────────────────────────────┐
│  Bun process (port 8000)                        │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │  Hono app                                 │  │
│  │                                           │  │
│  │  /api/review/*    → review routes (ours)  │  │
│  │  /session/*       → proxy to OpenCode     │  │
│  │  /event           → proxy to OpenCode     │  │
│  │  /global/*        → proxy to OpenCode     │  │
│  │  /find/*          → proxy to OpenCode     │  │
│  │  /file/*          → proxy to OpenCode     │  │
│  │  /config/*        → proxy to OpenCode     │  │
│  │  /agent           → proxy to OpenCode     │  │
│  │  /provider/*      → proxy to OpenCode     │  │
│  │  /auth/*          → proxy to OpenCode     │  │
│  │  /*               → static SolidJS app    │  │
│  └───────────────────────────────────────────┘  │
│                        │                        │
│  ┌─────────────────────▼─────────────────────┐  │
│  │  OpenCode server (in-proc, port 4096)     │  │
│  │  Agent loop, tools, sessions, LLM, SSE    │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
         ▲
         │ HTTPS / single origin
         │
┌────────┴────────┐
│  SolidJS app    │
│  (browser)      │
│                 │
│  @opencode/sdk  │
│  client         │
└─────────────────┘
```

## Decisions

- **Direct SDK types**: Frontend uses OpenCode SDK types (`Session`, `Message`, `Part`, etc.) natively. No backend translation layer.
- **In-proc OpenCode**: `createOpencode()` starts the OpenCode server inside the Bun process. A dumb HTTP proxy exposes it on the same origin as our Hono routes.
- **Single origin**: One port (8000) serves everything — no CORS configuration needed.
- **Client-side markdown**: `markdown-it` added to frontend for rendering assistant text parts.
- **Review formatting sidecar**: A `/api/review/format-diff` endpoint runs `prettier` (or other language formatters) server-side to reformat `before`/`after` file content to the client's screen width before diffing.
- **Review state**: Start with `localStorage` for viewed/comments. Add server persistence later if cross-device state is needed.
- **ACP dropped**: OpenCode handles ACP natively; all custom copilot-acp.ts code deleted.

## Phases

### Phase 0: Preparation

**Branch and archive.**

1. Create branch `archive/pre-opencode-migration` from current `main` to preserve the full codebase.
2. Create working branch `feat/opencode-migration`.

### Phase 1: Backend Scaffold (~80 lines new)

**Goal**: Single Bun process with OpenCode in-proc + Hono proxy + static serving. No review endpoints yet.

#### 1.1 Install dependencies

```bash
cd backend
bun add @opencode-ai/sdk hono
bun remove openai @agentclientprotocol/sdk zod-config  # no longer needed
```

Keep: `hono`, `drizzle-orm` (for future review persistence), `markdown-it` (remove later when moved to frontend), `zod`.

#### 1.2 New `backend/src/index.ts`

Replace entirely. New structure:

```ts
import { createOpencode } from "@opencode-ai/sdk"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { serveStatic } from "hono/bun"
import { proxy } from "./proxy"
// import { reviewRouter } from "./routes/review"  // Phase 3

const OPENCODE_PORT = 4096
const APP_PORT = Number(process.env.VOXPILOT_PORT ?? 8000)

const { client, server } = await createOpencode({
  hostname: "127.0.0.1",
  port: OPENCODE_PORT,
  config: { /* model, provider config from env */ },
})

const app = new Hono()
app.use("/*", cors({ origin: "*", credentials: true }))

// Review routes (Phase 3)
// app.route("/api/review", reviewRouter)

// Proxy all OpenCode API routes
const ocProxy = proxy(`http://127.0.0.1:${OPENCODE_PORT}`)
app.all("/session/*", ocProxy)
app.all("/event",     ocProxy)
app.all("/global/*",  ocProxy)
app.all("/find",      ocProxy)
app.all("/find/*",    ocProxy)
app.all("/file",      ocProxy)
app.all("/file/*",    ocProxy)
app.all("/config",    ocProxy)
app.all("/config/*",  ocProxy)
app.all("/agent",     ocProxy)
app.all("/provider",  ocProxy)
app.all("/provider/*",ocProxy)
app.all("/auth/*",    ocProxy)
app.all("/doc",       ocProxy)

// Static frontend
app.use("/*", serveStatic({ root: "./static" }))

Bun.serve({ fetch: app.fetch, port: APP_PORT, idleTimeout: 255 })
console.log(`VoxPilot running on http://0.0.0.0:${APP_PORT}`)
```

#### 1.3 New `backend/src/proxy.ts` (~20 lines)

```ts
import type { Context } from "hono"

export function proxy(target: string) {
  return async (c: Context) => {
    const url = new URL(c.req.url)
    const proxiedUrl = `${target}${url.pathname}${url.search}`
    const resp = await fetch(proxiedUrl, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.method !== "GET" ? c.req.raw.body : undefined,
      // @ts-expect-error duplex required for streaming bodies
      duplex: "half",
    })
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    })
  }
}
```

#### 1.4 Delete old backend code

Delete these files/directories entirely:

- `backend/src/services/agent.ts` (599 lines — agent loop)
- `backend/src/services/streams.ts` (337 lines — SSE broadcaster)
- `backend/src/services/copilot-acp.ts` (220 lines — ACP integration)
- `backend/src/services/system-prompt.ts` (22 lines)
- `backend/src/services/sessions.ts` (198 lines — session CRUD)
- `backend/src/services/markdown.ts` (50 lines — moves to frontend in Phase 2)
- `backend/src/routes/chat.ts` (196 lines — SSE stream, message post, confirm)
- `backend/src/routes/sessions.ts` (55 lines — session CRUD)
- `backend/src/routes/health.ts`
- `backend/src/tools/` (entire directory, ~265 lines)
- `backend/src/schemas/api.ts`
- `backend/src/schemas/events.ts`
- `backend/src/config.ts` (38 lines — replaced by OpenCode config)
- `backend/src/db.ts` (database init — defer removal until review persistence decided)
- `backend/src/schema.ts` (keep artifact-related tables only, remove sessions/messages/acpSessions)
- `backend/drizzle/` (migrations — regenerate if keeping review tables)
- `backend/tests/agent.test.ts`, `chat.test.ts`, `config.test.ts`, `sessions.test.ts`, `streams.test.ts`, `tools.test.ts`

**Keep for Phase 3**:

- `backend/src/services/diff-render.ts` (185 lines — HTML rendering)
- `backend/src/services/artifacts.ts` (257 lines — review persistence, optional)
- `backend/src/routes/artifacts.ts` (149 lines — review endpoints, refactored in Phase 3)
- `backend/tests/diff-render.test.ts`, `artifacts.test.ts`

**Delete (no longer needed with OpenCode's `before`/`after` model)**:

- `backend/src/services/diff-parser.ts` (240 lines)
- `backend/src/services/diff-fulltext.ts`
- `backend/src/services/artifact-pipeline.ts` (145 lines)
- `backend/src/schemas/diff-document.ts`
- `backend/tests/diff-parser.test.ts`

#### 1.5 Update `backend/tsconfig.json`

Remove path aliases to deleted modules. Ensure `@opencode-ai/sdk` resolves.

#### 1.6 Verify

- `cd backend && bun run src/index.ts` starts without errors
- `curl http://localhost:8000/global/health` returns `{ healthy: true }`
- `curl http://localhost:8000/session` returns `[]`

---

### Phase 2: Frontend Migration (~550 lines rewritten)

**Goal**: Frontend uses OpenCode SDK types directly. Chat works end-to-end.

#### 2.1 Install dependencies

```bash
cd frontend
npm install @opencode-ai/sdk markdown-it
npm install -D @types/markdown-it
npm uninstall hono  # was only used for hc<AppType>() RPC
```

#### 2.2 Update `frontend/tsconfig.json`

Remove the `@backend/*` path alias. No more cross-boundary type imports.

```diff
- "@backend/*": ["../backend/src/*"]
```

#### 2.3 Update `frontend/vite.config.ts`

Remove the `@backend` alias. Add dev proxy:

```ts
server: {
  proxy: {
    "/session": "http://localhost:8000",
    "/event": "http://localhost:8000",
    "/global": "http://localhost:8000",
    "/find": "http://localhost:8000",
    "/file": "http://localhost:8000",
    "/config": "http://localhost:8000",
    "/agent": "http://localhost:8000",
    "/provider": "http://localhost:8000",
    "/auth": "http://localhost:8000",
    "/api": "http://localhost:8000",
  }
}
```

#### 2.4 Rewrite `frontend/src/api-client.ts` (~80 lines)

Replace Hono RPC client with OpenCode SDK client:

```ts
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { Session, Message, Part } from "@opencode-ai/sdk"

export const client = createOpencodeClient({
  baseUrl: window.location.origin,
})

export async function fetchSessions(): Promise<Session[]> {
  const result = await client.session.list()
  return result.data ?? []
}

export async function createSession(title?: string): Promise<Session> {
  const result = await client.session.create({ body: { title } })
  return result.data!
}

export async function deleteSession(id: string): Promise<void> {
  await client.session.delete({ path: { id } })
}

export async function fetchMessages(sessionId: string) {
  const result = await client.session.messages({ path: { id: sessionId } })
  return result.data ?? []
}

export async function sendPromptAsync(
  sessionId: string,
  text: string,
): Promise<void> {
  await client.session.prompt({
    path: { id: sessionId },
    body: { parts: [{ type: "text", text }] },
  })
}

export async function abortSession(sessionId: string): Promise<void> {
  await client.session.abort({ path: { id: sessionId } })
}

export async function respondToPermission(
  sessionId: string,
  permissionId: string,
  response: "once" | "always" | "reject",
): Promise<void> {
  await client.postSessionByIdPermissionsByPermissionId({
    path: { id: sessionId, permissionID: permissionId },
    body: { response },
  })
}

export async function fetchSessionDiff(sessionId: string) {
  const result = await client.session.diff({ path: { id: sessionId } })
  return result.data ?? []
}
```

#### 2.5 Rewrite `frontend/src/store.ts` (~50 lines changed)

Replace all `@backend/*` imports with SDK types:

```ts
import type { Session, Message, Part, TextPart, ToolPart, FileDiff } from "@opencode-ai/sdk"

// A full message as returned by the SDK
export type MessageWithParts = { info: Message; parts: Part[] }

// Streaming state for in-flight tool calls
export type StreamingToolCall = {
  id: string
  partId: string       // Part.id for matching updates
  name: string
  state: string        // ToolState from SDK
  input?: unknown
  output?: string
  isError?: boolean
}

export type PendingPermission = {
  sessionId: string
  permissionId: string
  toolName: string
  args: string
}

export type ContextUsage = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  cacheWrite: number
}
```

Remove: `ArtifactSummary`, `ArtifactFileSummary`, `ArtifactFileDetail`, `ReviewCommentData`, `ReviewOverlayTarget` types. Remove: `artifacts`, `reviewOverlayArtifactId`, `reviewDetail` signals. (Re-added in Phase 3.)

Keep: `sessions`, `activeIndex`, `messages`, `streamingText`, `streamingToolCalls`, `isStreaming`, `errorMessage`, `pickerOpen`, `swipeOffset`, `pendingConfirm` (rename to `pendingPermission`), `contextUsage`, `toasts`.

#### 2.6 Rewrite `frontend/src/sse.ts` (~100 lines)

Replace custom EventSource with SDK event subscription:

```ts
import { client } from "./api-client"

export type EventCallback = (event: { type: string; properties: unknown }) => void

let eventStream: AsyncIterable<unknown> | null = null

export async function subscribeToEvents(onEvent: EventCallback): Promise<void> {
  const response = await client.event.subscribe()
  eventStream = response.stream
  for await (const event of eventStream) {
    onEvent(event as { type: string; properties: unknown })
  }
}
```

#### 2.7 Rewrite `frontend/src/streaming.ts` (~200 lines rewritten)

Map OpenCode's global event stream to SolidJS signals. Key event types to handle:

| OpenCode Event | Action |
|---|---|
| `message.updated` where `properties.info.sessionID === activeSessionId()` | Update message in store |
| `part.updated` where `properties.part.type === "text"` | Feed `part.text` into rAF-batched `setStreamingText` |
| `part.updated` where `properties.part.type === "tool"` | Update `setStreamingToolCalls` based on `ToolState` |
| `part.updated` where `properties.part.type === "step-start"` | Mark streaming in progress |
| `part.updated` where `properties.part.type === "step-finish"` | Extract token usage → `setContextUsage` |
| `session.updated` | Refresh session list if title changed |

**Keep the rAF batching logic** — the pattern of accumulating text deltas in a buffer and flushing once per animation frame is valuable for mobile performance. The implementation changes (different event shape) but the technique stays.

```ts
// Core pattern preserved:
let pendingText = ""
let rafId: number | null = null

function flushText() {
  if (pendingText) {
    setStreamingText(prev => (prev ?? "") + pendingText)
    pendingText = ""
  }
  rafId = null
}

function handleTextDelta(text: string) {
  pendingText += text
  if (!rafId) {
    rafId = requestAnimationFrame(flushText)
  }
}
```

Filter all events by `activeSessionId()` — OpenCode's event stream is global, not per-session.

Exported functions (signatures preserved, internals rewritten):
- `openStream(sessionId)` — subscribe to events, filter by session, load history via `fetchMessages()`
- `closeStream()` — abort event subscription
- `sendUserMessage(content)` — call `sendPromptAsync()`, set `isStreaming(true)`
- `respondToConfirm(permissionId, response)` — call `respondToPermission()`

#### 2.8 Update `frontend/src/sessions.ts` (~20 lines changed)

Swap `fetchSessions`/`createSession`/`deleteSession` calls to use the new api-client functions. Logic flow unchanged.

#### 2.9 Add `frontend/src/markdown.ts` (~15 lines)

```ts
import MarkdownIt from "markdown-it"

const md = new MarkdownIt({ html: false, typographer: true })
export function renderMarkdown(text: string): string {
  if (!text) return ""
  return md.render(text)
}
```

#### 2.10 Update `frontend/src/components/MessageBubble.tsx` (~60 lines rewritten)

Render `MessageWithParts` instead of flat `MessageRead`:

```tsx
function MessageBubble(props: { msg: MessageWithParts }) {
  const textContent = () =>
    props.msg.parts
      .filter((p): p is TextPart => p.type === "text")
      .map(p => p.text)
      .join("")

  const toolParts = () =>
    props.msg.parts.filter((p): p is ToolPart => p.type === "tool")

  return (
    <div class={`bubble ${props.msg.info.role}`}>
      <Show when={props.msg.info.role === "assistant"}>
        <div innerHTML={renderMarkdown(textContent())} />
      </Show>
      <Show when={props.msg.info.role === "user"}>
        <p>{textContent()}</p>
      </Show>
      <For each={toolParts()}>
        {(part) => <ToolCallBlock part={part} />}
      </For>
    </div>
  )
}
```

#### 2.11 Update `frontend/src/components/ToolCallBlock.tsx` (~40 lines rewritten)

Read from `ToolPart` instead of custom `StreamingToolCall`:

```tsx
function ToolCallBlock(props: { part: ToolPart }) {
  return (
    <details class="tool-call">
      <summary>
        {props.part.tool} — {props.part.state.status}
        <Show when={props.part.state.status === "running"}>
          <span class="spinner" />
        </Show>
      </summary>
      <Show when={props.part.state.input}>
        <pre>{JSON.stringify(props.part.state.input, null, 2)}</pre>
      </Show>
      <Show when={props.part.state.output}>
        <pre>{props.part.state.output}</pre>
      </Show>
    </details>
  )
}
```

#### 2.12 Update `frontend/src/components/ToolConfirmBlock.tsx` (~15 lines changed)

Replace boolean approve/reject with OpenCode's permission model:

```tsx
<button onClick={() => respondToConfirm(perm.permissionId, "once")}>Allow once</button>
<button onClick={() => respondToConfirm(perm.permissionId, "always")}>Always allow</button>
<button onClick={() => respondToConfirm(perm.permissionId, "reject")}>Reject</button>
```

#### 2.13 Delete `frontend/src/components/CopilotStreamBlock.tsx`

ACP is internal to OpenCode now.

#### 2.14 Temporarily stub review components

Comment out imports/usage of `ChangesetCard`, `ReviewOverlay`, and `ContextUsageBar` (re-added in Phase 3). Remove `ReviewOverlay` from `ChatView.tsx`.

#### 2.15 Update `frontend/src/components/ChatView.tsx`

Replace health check from `GET /api/health` to `client.global.health()`. Remove `ReviewOverlay`.

#### 2.16 Verify

- `just dev-frontend` + `just dev-backend` starts both processes
- Creating a session shows in the session picker
- Sending a message streams back text and renders markdown
- Tool calls appear as collapsible blocks
- Permission prompts show allow/reject buttons
- `npx tsc --noEmit` passes with no `@backend/*` imports remaining

---

### Phase 3: Review System (~300 lines new)

**Goal**: Mobile-optimized code review with server-side formatting.

#### 3.1 Install `prettier` and `diff` in backend

```bash
cd backend
bun add prettier diff
bun add -D @types/diff
```

#### 3.2 New `backend/src/services/format-diff.ts` (~150 lines)

```ts
import * as prettier from "prettier"
import { diffLines } from "diff"
import { renderDiffHtml } from "./diff-render"

interface FormatDiffInput {
  before: string
  after: string
  filePath: string
  printWidth: number
}

interface FormatDiffResult {
  formattedBefore: string
  formattedAfter: string
  hunks: Hunk[]
  html: string
}

export async function formatAndDiff(input: FormatDiffInput): Promise<FormatDiffResult> {
  const parser = detectParser(input.filePath)
  const options = { printWidth: input.printWidth, parser }

  const [formattedBefore, formattedAfter] = await Promise.all([
    tryFormat(input.before, options),
    tryFormat(input.after, options),
  ])

  const changes = diffLines(formattedBefore, formattedAfter)
  const hunks = buildHunks(changes)
  const html = renderDiffHtml(hunks, input.filePath)

  return { formattedBefore, formattedAfter, hunks, html }
}

function detectParser(filePath: string): string {
  const ext = filePath.split(".").pop()
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "babel", jsx: "babel",
    json: "json", css: "css", html: "html", md: "markdown",
    yaml: "yaml", yml: "yaml", graphql: "graphql",
  }
  return map[ext ?? ""] ?? "babel"
}

async function tryFormat(content: string, options: prettier.Options): Promise<string> {
  try {
    return await prettier.format(content, options)
  } catch {
    return content // return unformatted if prettier can't handle it
  }
}
```

#### 3.3 New `backend/src/routes/review.ts` (~50 lines)

```ts
import { Hono } from "hono"
import { formatAndDiff } from "../services/format-diff"

export const reviewRouter = new Hono()

// POST /api/review/format-diff
// Body: { before, after, filePath, printWidth }
// Returns: { formattedBefore, formattedAfter, hunks, html }
reviewRouter.post("/format-diff", async (c) => {
  const body = await c.req.json()
  const result = await formatAndDiff(body)
  return c.json(result)
})
```

#### 3.4 Adapt `backend/src/services/diff-render.ts`

Refactor to accept `diff` library output (array of changes with `added`/`removed`/`value`) instead of the old parsed-hunk format. Keep the HTML table structure with `data-line-id` attributes — the frontend relies on these for comment anchoring.

#### 3.5 Uncomment review routes in `backend/src/index.ts`

```ts
import { reviewRouter } from "./routes/review"
app.route("/api/review", reviewRouter)
```

#### 3.6 Restore `frontend/src/components/ChangesetCard.tsx`

Adapt data source from `ArtifactSummary` to OpenCode's `FileDiff[]`:

```ts
import type { FileDiff } from "@opencode-ai/sdk"

interface Props {
  sessionId: string
  diffs: FileDiff[]  // from client.session.diff()
}
```

Keep the file tree grouping, +/- stats, viewed indicators (from localStorage), "Review next" button.

#### 3.7 Restore `frontend/src/components/ReviewOverlay.tsx`

The flow becomes:

1. User taps file → overlay opens
2. `clientWidth` measured → `printWidth = Math.floor(containerWidth / charWidth)`
3. `POST /api/review/format-diff` with `{ before, after, filePath, printWidth }`
4. Response HTML rendered via `innerHTML`
5. Viewed/comment state stored in `localStorage` keyed by `sessionId:filePath`
6. Screen rotation → debounced re-request with new `printWidth`

#### 3.8 Add review state to localStorage

```ts
// frontend/src/review-state.ts (~50 lines)
interface FileReviewState {
  viewed: boolean
  comments: Array<{ lineId: string; text: string; createdAt: string }>
}

function key(sessionId: string, filePath: string) {
  return `voxpilot:review:${sessionId}:${filePath}`
}

export function getFileState(sessionId: string, filePath: string): FileReviewState { ... }
export function markViewed(sessionId: string, filePath: string): void { ... }
export function addComment(sessionId: string, filePath: string, lineId: string, text: string): void { ... }
export function deleteComment(sessionId: string, filePath: string, index: number): void { ... }
```

#### 3.9 Integrate ChangesetCard into chat flow

When OpenCode completes a message that includes file edits, detect this from the `Part[]` (look for tool parts with file-writing tools like `write_file`, `edit_file`, or `patch`). Fetch `client.session.diff()` and render a `ChangesetCard` inline.

#### 3.10 Verify

- After the agent edits files, a ChangesetCard appears in chat
- Tapping a file opens the ReviewOverlay
- Code is formatted to screen width (rotate device → reformats)
- Viewed checkboxes and comments persist across page reloads
- `just check` passes

---

### Phase 4: Cleanup

#### 4.1 Delete remaining dead backend code

- Remove `backend/src/services/diff-parser.ts`, `diff-fulltext.ts`, `artifact-pipeline.ts`
- Remove `backend/src/schemas/diff-document.ts`, `backend/src/schemas/events.ts`, `backend/src/schemas/api.ts`
- Remove `backend/src/db.ts` and `backend/src/schema.ts` if not using SQLite for review persistence
- Remove `backend/drizzle/` directory
- Remove old test files: `agent.test.ts`, `chat.test.ts`, `config.test.ts`, `sessions.test.ts`, `streams.test.ts`, `tools.test.ts`, `diff-parser.test.ts`

#### 4.2 Update `backend/package.json`

Remove unused dependencies: `openai`, `@agentclientprotocol/sdk`, `zod-config`, `drizzle-orm` (if no review persistence), `drizzle-kit`, `@hono/zod-validator`.

Final runtime dependencies: `@opencode-ai/sdk`, `hono`, `prettier`, `diff`, `zod` (if validating review requests).

#### 4.3 Update `Justfile`

```just
set dotenv-load

install:
    cd backend && bun install
    cd frontend && npm install

dev-backend:
    cd backend && bun run --hot src/index.ts

dev-frontend:
    cd frontend && npm run dev

test:
    cd backend && bun test

lint:
    cd backend && bunx @biomejs/biome check src
    cd frontend && npx tsc --noEmit

typecheck:
    cd backend && bunx tsc --noEmit
    cd frontend && npx tsc --noEmit

format:
    cd backend && bunx @biomejs/biome check --write src

build:
    cd frontend && npm run build

build-static:
    just build
    rm -rf backend/static/assets
    cp -r frontend/dist/* backend/static/

check:
    just install
    just lint
    just typecheck
    just test

clean:
    rm -rf frontend/dist backend/tsconfig.tsbuildinfo
```

#### 4.4 Update `README.md`

Document the new architecture: OpenCode as the engine, VoxPilot as the web UI + review system.

#### 4.5 Final backend structure

```
backend/
  src/
    index.ts              # Hono app + createOpencode() + proxy + static
    proxy.ts              # HTTP proxy helper (~20 lines)
    services/
      diff-render.ts      # HTML diff rendering (adapted)
      format-diff.ts      # prettier + jsdiff + render
    routes/
      review.ts           # POST /api/review/format-diff
  tests/
    diff-render.test.ts   # Kept/adapted
    format-diff.test.ts   # New
  static/                 # Built frontend assets
  package.json
  tsconfig.json
  biome.json
```

~250 lines of backend code, down from ~2,500.

---

## Line Count Summary

| What | Before | After | Delta |
|---|---|---|---|
| Backend code | ~2,500 | ~250 | **−2,250** |
| Frontend code (rewritten) | — | ~550 | rewritten, not net new |
| Frontend code (total) | ~1,700 | ~1,600 | **−100** (removed Copilot/artifact components, added markdown) |
| Tests | ~800 | ~100 | **−700** (OpenCode owns most tested logic now) |

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| OpenCode SDK event types change across versions | Pin `@opencode-ai/sdk` version; upgrade deliberately |
| SSE reconnect — global stream loses events | On reconnect, call `fetchMessages(sessionId)` to backfill; rAF batching smooths visual jank |
| `createOpencode()` in-proc startup failure | Catch error, show health status in UI, allow retry |
| `prettier` doesn't support a language | `tryFormat()` falls back to unformatted content gracefully |
| OpenCode's `FileDiff` doesn't include a file the agent edited | `FileDiff` is per-session cumulative; fallback to showing tool output text |
| Mobile performance with client-side markdown | `markdown-it` is ~30KB gzipped, renders fast; monitor and lazy-load if needed |
