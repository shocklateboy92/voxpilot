# SDK v2 Migration Plan

Migrate VoxPilot frontend and backend from `@opencode-ai/sdk/client` (v1) to `@opencode-ai/sdk/v2/client`. The v2 SDK is already installed (same 1.2.10 package, different export path). It flattens all method parameters, overhauls the permission system, adds the question system, and introduces delta events for streaming.

## Key v2 Changes

### Method Signature Style (Breaking)

V2 flattens `{ body, path, query }` bags into named parameters:

```ts
// v1
client.session.delete({ path: { id } })
client.session.messages({ path: { id: sessionId } })
client.session.promptAsync({ path: { id }, body: { parts } })

// v2
client.session.delete({ sessionID: id })
client.session.messages({ sessionID: sessionId })
client.session.promptAsync({ sessionID: id, parts })
```

### Permission System Overhaul

| Aspect | v1 | v2 |
|---|---|---|
| Type | `Permission` | `PermissionRequest` |
| Event | `"permission.updated"` | `"permission.asked"` |
| Reply event fields | `permissionID`, `response` | `requestID`, `reply` |
| Has `title` | Yes | **No** — use `permission` field (tool type string) |
| Has `pattern` | `string \| string[]` | `patterns: string[]` (always array) |
| Has `time` | Yes | **No** |
| Method | `client.postSessionIdPermissionsPermissionId(...)` | `client.permission.reply({ requestID, reply })` |

### New: Question System

Types: `QuestionOption`, `QuestionInfo`, `QuestionRequest`, `QuestionAnswer`
Events: `question.asked`, `question.replied`, `question.rejected`
Client methods: `client.question.list()`, `client.question.reply({ requestID, answers })`, `client.question.reject({ requestID })`

```ts
type QuestionOption = { label: string; description: string }
type QuestionInfo = {
  question: string; header: string; options: QuestionOption[]
  multiple?: boolean; custom?: boolean
}
type QuestionRequest = {
  id: string; sessionID: string; questions: QuestionInfo[]
  tool?: { messageID: string; callID: string }
}
type QuestionAnswer = string[] // array of selected labels per question
```

### New: Delta Events

V2 adds `EventMessagePartDelta` (`"message.part.delta"`) with `{ sessionID, messageID, partID, field, delta }`. The `delta` field was removed from `EventMessagePartUpdated`. Both can coexist — the full `part` is still sent in `message.part.updated`, so the current full-text-replacement approach still works.

### New Event Types (v2 only)

`question.asked`, `question.replied`, `question.rejected`, `message.part.delta`, `permission.asked` (renamed from `permission.updated`), `global.disposed`, `project.updated`, `tui.session.select`, `mcp.tools.changed`, `mcp.browser.open.failed`, `worktree.ready`, `worktree.failed`

### Type Changes

- `Session` adds: `slug`, `time.archived?`, `permission?: PermissionRuleset`
- `AssistantMessage` adds: `agent`, `tokens.total?`, `structured?`, `variant?`, new error variants `StructuredOutputError`, `ContextOverflowError`
- `SubtaskPart` adds: `model?`, `command?`
- `StepFinishPart.tokens` adds: `total?`
- `FileDiff` adds: `status?: "added" | "deleted" | "modified"`
- `Part` union: structurally identical (same 12 members), no new part types

---

## Migration Steps

### Step 1: Backend — Update imports and method signatures

**Files:** `backend/src/index.ts`, `backend/src/routes/review.ts`

In `index.ts`:
```diff
-import { createOpencode } from "@opencode-ai/sdk";
+import { createOpencode } from "@opencode-ai/sdk/v2";
```

In `routes/review.ts`:
```diff
-import type { OpencodeClient } from "@opencode-ai/sdk/client";
+import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
```
```diff
-const diffResult = await client.session.diff({
-  path: { id: body.sessionId },
-});
+const diffResult = await client.session.diff({
+  sessionID: body.sessionId,
+});
```

### Step 2: Frontend — Update `api-client.ts`

Import path and all method calls change:

```diff
-import type { FileDiff, Message, Part, Session } from "@opencode-ai/sdk/client";
-import { createOpencodeClient } from "@opencode-ai/sdk/client";
+import type { FileDiff, Message, Part, Session, QuestionRequest, QuestionAnswer, PermissionRequest } from "@opencode-ai/sdk/v2/client";
+import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
```

Method rewrites:
```diff
-const result = await client.session.create({ body: { title } });
+const result = await client.session.create({ title });

-await client.session.delete({ path: { id } });
+await client.session.delete({ sessionID: id });

-const result = await client.session.messages({ path: { id: sessionId } });
+const result = await client.session.messages({ sessionID: sessionId });

-await client.session.promptAsync({ path: { id: sessionId }, body: { parts: [{ type: "text", text }] } });
+await client.session.promptAsync({ sessionID: sessionId, parts: [{ type: "text", text }] });

-await client.session.abort({ path: { id: sessionId } });
+await client.session.abort({ sessionID: sessionId });

-const result = await client.session.diff({ path: { id: sessionId } });
+const result = await client.session.diff({ sessionID: sessionId });
```

Replace `respondToPermission()`:
```diff
-export async function respondToPermission(
-  sessionId: string,
-  permissionId: string,
-  response: "once" | "always" | "reject",
-): Promise<void> {
-  await client.postSessionIdPermissionsPermissionId({
-    path: { id: sessionId, permissionID: permissionId },
-    body: { response },
-  });
-}
+export async function respondToPermission(
+  requestID: string,
+  reply: "once" | "always" | "reject",
+): Promise<void> {
+  await client.permission.reply({ requestID, reply });
+}
```

Add question API functions:
```ts
export async function replyToQuestion(
  requestID: string,
  answers: QuestionAnswer[],
): Promise<void> {
  await client.question.reply({ requestID, answers });
}

export async function rejectQuestion(requestID: string): Promise<void> {
  await client.question.reject({ requestID });
}
```

### Step 3: Frontend — Update `store.ts`

```diff
-import type { Permission } from "@opencode-ai/sdk/client";
+import type { PermissionRequest } from "@opencode-ai/sdk/v2/client";
+import type { QuestionRequest } from "@opencode-ai/sdk/v2/client";

-export type PendingPermission = Permission;
+export type PendingPermission = PermissionRequest;

+export const [pendingQuestion, setPendingQuestion] =
+  createSignal<QuestionRequest | null>(null);
```

### Step 4: Frontend — Update `sse.ts`

```diff
-import type { Event } from "@opencode-ai/sdk/client";
+import type { Event } from "@opencode-ai/sdk/v2/client";
```

### Step 5: Frontend — Update `streaming.ts`

Import `setPendingQuestion` from store.

Event handler changes:
```diff
-case "permission.updated": {
+case "permission.asked": {

 case "permission.replied": {
-  setPendingPermission(null);
+  setPendingPermission(null);
   break;
 }

+case "question.asked": {
+  const req = event.properties;
+  if (req.sessionID !== sid) return;
+  setPendingQuestion(req);
+  break;
+}
+
+case "question.replied":
+case "question.rejected": {
+  setPendingQuestion(null);
+  break;
+}
```

Update `respondToConfirm()` — the `PermissionRequest` type uses `id` as the request ID:
```diff
-export async function respondToConfirm(
-  permissionId: string,
-  response: "once" | "always" | "reject",
-): Promise<void> {
-  const sessionId = activeSessionId();
-  if (!sessionId) return;
-  setPendingPermission(null);
-  try {
-    await respondToPermission(sessionId, permissionId, response);
-  } catch ...
+export async function respondToConfirm(
+  requestID: string,
+  reply: "once" | "always" | "reject",
+): Promise<void> {
+  setPendingPermission(null);
+  try {
+    await respondToPermission(requestID, reply);
+  } catch ...
```

### Step 6: Frontend — Update `ToolConfirmBlock.tsx`

`PermissionRequest` no longer has `title`. Replace with `permission` field (tool type string):
```diff
-🔒 <strong>{props.permission.title}</strong> requires approval
+🔒 <strong>{props.permission.permission}</strong> requires approval
```

Update button handlers — pass `props.permission.id` (still the same field name):
```diff
-onClick={() => void respondToConfirm(props.permission.id, "once")}
+onClick={() => void respondToConfirm(props.permission.id, "once")}
```
(No change needed for the `id` access — it's the same in both types.)

### Step 7: Frontend — Update component type import paths

These files only need `"@opencode-ai/sdk/client"` → `"@opencode-ai/sdk/v2/client"`:

- `components/ChatMain.tsx` — `ToolPart`
- `components/MessageBubble.tsx` — `TextPart`, `ToolPart`
- `components/ToolCallBlock.tsx` — `ToolPart`
- `components/ChangesetCard.tsx` — `FileDiff`

### Step 8: Add `QuestionBlock` component

Create `frontend/src/components/QuestionBlock.tsx`:
- Reads from `pendingQuestion()` signal
- Renders each `QuestionInfo` with header, question text, and option chips
- Supports `multiple` (multi-select) and `custom` (freeform text input, default true)
- Submit calls `replyToQuestion(request.id, answers)` from api-client
- Reject calls `rejectQuestion(request.id)`

Wire into `ChatMain.tsx`:
```tsx
<Show when={pendingQuestion()}>
  {(req) => <QuestionBlock request={req()} />}
</Show>
```

Add CSS styles in `style.css`.

### Step 9 (Optional): Optimize text streaming with delta events

Handle `"message.part.delta"` to append incremental text instead of replacing full text on every `message.part.updated`. This is a performance optimization — the current approach still works in v2.

---

## Verification

- `just typecheck` — no type errors
- `just lint` — Biome compliance
- Manual: send a message, verify streaming text works
- Manual: trigger a permission-requiring tool, verify confirm UI with new `PermissionRequest` shape
- Manual: trigger the `question` tool, verify QuestionBlock renders and reply/reject work
- Manual: verify review overlay loads diffs correctly
