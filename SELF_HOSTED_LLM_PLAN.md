# Self-Hosted LLM Integration Plan

> **Status: Plan — awaiting review.**
> Move the primary AI off GitHub Models onto a self-hosted inference
> server running on the local RTX 4090 (24 GB VRAM). Remove the GitHub
> Models provider entirely, along with the GitHub OAuth authentication
> flow that was only needed to obtain API keys for it.

---

## Motivation

VoxPilot currently sends every LLM request to the GitHub Models API
(`models.inference.ai.azure.com`) using the user's GitHub OAuth token as
the API key. This has several problems:

1. **Latency** — round-trip to Azure adds 200–500 ms on top of
   inference time.
2. **Privacy** — all code context leaves the local network.
3. **Cost / rate limits** — GitHub Models free-tier limits are very low,
   and enterprise licenses only work inside the Copilot CLI (which we
   already run via ACP mode).
4. **Model choice** — limited to the models GitHub exposes.
5. **Unnecessary auth complexity** — the entire GitHub OAuth flow exists
   solely to obtain a token for GitHub Models. With a self-hosted
   provider, there's no need for it.

A self-hosted inference server on the local RTX 4090 eliminates all five
issues and aligns with VoxPilot's "self-hosted" identity. Removing the
auth flow simplifies the codebase significantly.

---

## 1  Inference Server: Ollama (recommended)

### Why Ollama

| Criterion | Ollama | vLLM | llama.cpp |
|---|---|---|---|
| Setup complexity | One binary, `ollama serve` | Python venv + CUDA toolkit | Compile from source or use prebuilt |
| OpenAI-compatible API | `http://localhost:11434/v1/` | `http://localhost:8000/v1/` | External wrapper needed |
| Tool/function calling | Built-in (OpenAI-format `tools` array) | Built-in | Not native |
| Streaming | SSE `text/event-stream` | SSE | Varies |
| Model management | `ollama pull qwen3-coder` | Manual download + config | Manual GGUF download |
| Multi-model hot-swap | Yes (keeps recently-used models in VRAM) | One model per process | One model per process |
| Concurrency | Single-user optimised (fine for VoxPilot) | High-throughput batching | Single-user |
| VRAM management | Automatic load/unload | Manual | Manual |

**Ollama wins on developer experience.** VoxPilot is a single-user app,
so Ollama's concurrency limitation is irrelevant. Its built-in
OpenAI-compatible endpoint means the existing `openai` SDK in
`agent.ts` works with a two-line config change (baseURL + apiKey).

### Fallback: vLLM

If we later need multi-user throughput or serving models that Ollama
doesn't support, vLLM is the natural step-up. It also exposes an
OpenAI-compatible API, so the same integration pattern applies.

---

## 2  Model Recommendations

### Primary model: Qwen 3 Coder 32B (Q4 quantization)

| Property | Value |
|---|---|
| Parameters | 32B (≈22B active via MoE) |
| Quantization | Q4 (GGUF) — ~18 GB VRAM |
| Context window | 128k tokens |
| Tool calling | Native support (OpenAI-format) |
| License | Apache 2.0 |
| Ollama name | `qwen3-coder:32b` (exact tag TBD — check `ollama list` after pull) |
| Strengths | SOTA on coding benchmarks (HumanEval 84%+), strong agentic behaviour, large context for repo-scale tasks |

### Alternate models worth testing

| Model | Size | VRAM (Q4) | Why consider |
|---|---|---|---|
| **DeepSeek Coder V2 21B** | 21B | ~12 GB | Excellent for frontend/UI code, fast inference |
| **Qwen 3.5 22B** | 22B | ~14 GB | Newer, potentially better reasoning |
| **CodeLlama 34B** | 34B | ~20 GB | Meta-backed, broad documentation |
| **DeepSeek R1 32B** | 32B | ~18 GB | Strong reasoning, good at multi-step tasks |

All fit comfortably within 24 GB VRAM at 4-bit quantization. The
integration is model-agnostic — swapping models is a one-line config
change.

---

## 3  Integration Architecture

### Current flow

```
Frontend → LoginView (GitHub OAuth) → gh_token cookie
         → POST /api/sessions/{id}/messages { content, model: "gpt-4o" }
           (authMiddleware extracts gh_token from cookie)
         → agent.ts → new OpenAI({ baseURL: GITHUB_MODELS, apiKey: ghToken })
         → models.inference.ai.azure.com
```

### Proposed flow

```
Frontend → ChatView (no login required)
         → POST /api/sessions/{id}/messages { content }
         → agent.ts → new OpenAI({ baseURL, apiKey })  ← from config
         → localhost:11434  (self-hosted Ollama)

Frontend ← GET /api/health  → { status, llm: "connected", model: "qwen3-coder:32b" }
           (health indicator replaces user avatar / sign-out button)
```

The key insight is that Ollama's `/v1/chat/completions` endpoint is
wire-compatible with the OpenAI SDK. **The agent loop (`agent.ts`) does
not need to change its core logic.** Only the client construction needs
to be parameterised.

Since GitHub Models is removed entirely, the GitHub OAuth flow, auth
middleware, and all `ghToken` plumbing can be deleted.

---

## 4  Implementation Steps

### Step 1: Add LLM provider configuration to `config.ts`

Add new environment variables, remove GitHub OAuth vars:

```
VOXPILOT_LLM_BASE_URL=http://localhost:11434/v1
VOXPILOT_LLM_API_KEY=ollama           # Ollama ignores this, but SDK requires it
VOXPILOT_LLM_DEFAULT_MODEL=qwen3-coder:32b
```

Update the Zod config schema:

```typescript
// Add
llmBaseUrl: z.string().default("http://localhost:11434/v1"),
llmApiKey: z.string().default("ollama"),
llmDefaultModel: z.string().default("qwen3-coder:32b"),

// Remove
githubClientId      // no longer needed
githubClientSecret  // no longer needed
```

Estimated effort: **~10 min, ~10 lines changed.**

### Step 2: Remove GitHub auth flow (backend)

Delete or gut the following files:

| File | Action |
|---|---|
| `backend/src/routes/auth.ts` | **Delete** — login, callback, logout, /me endpoints |
| `backend/src/middleware/auth.ts` | **Delete** — `authMiddleware` and `AuthEnv` type |
| `backend/src/services/github.ts` | **Delete** — OAuth token exchange, user fetch |
| `backend/tests/auth.test.ts` | **Delete** — auth route tests |

Update files that reference auth:

| File | Change |
|---|---|
| `backend/src/index.ts` | Remove `authMiddleware` from protected routes; remove `authRouter` import and `.route()` call. All routes become public. |
| `backend/src/routes/chat.ts` | Remove `AuthEnv` type param from Hono app; remove `c.get("ghToken")`; remove `gh_token` from message payload. |
| `backend/src/routes/sessions.ts` | Remove `AuthEnv` type param. |
| `backend/src/routes/artifacts.ts` | Remove `AuthEnv` type param. |
| `backend/src/services/streams.ts` | Remove `gh_token` from `MessagePayload` type. |
| `backend/src/schemas/api.ts` | Remove `GitHubUser` schema (or keep if used elsewhere). |

Estimated effort: **~45 min, ~4 files deleted, ~6 files updated.**

### Step 3: Update the agent loop (`agent.ts`)

Replace the inline `new OpenAI(...)` that uses `ghToken`:

```typescript
// Before (inside the per-iteration loop):
const client = new OpenAI({
  baseURL: GITHUB_MODELS_BASE_URL,
  apiKey: ghToken,
});

// After (once, outside the loop):
const client = new OpenAI({
  baseURL: config.llmBaseUrl,
  apiKey: config.llmApiKey,
});
```

Remove `ghToken` from `AgentLoopOptions` interface. Remove the
`GITHUB_MODELS_BASE_URL` constant. Move client creation outside the
per-iteration loop (it's stateless).

Resolve the model name: use `opts.model` if provided, otherwise fall
back to `config.llmDefaultModel`.

Estimated effort: **~20 min, ~15 lines changed.**

### Step 4: Remove GitHub auth flow (frontend)

| File | Change |
|---|---|
| `frontend/src/components/LoginView.tsx` | **Delete** — no login view needed |
| `frontend/src/App.tsx` | Remove auth check on mount, remove `LoginView` import, remove `user()`/`authChecked()` gating — go directly to `ChatView`. |
| `frontend/src/components/ChatView.tsx` | Remove `GitHubUser` prop, remove user avatar / "Sign out" button — replace with LLM health indicator (see Step 5). |
| `frontend/src/store.ts` | Remove `user`, `setUser`, `authChecked`, `setAuthChecked` signals. Remove `GitHubUser` re-export. |
| `frontend/src/api-client.ts` | Remove `fetchCurrentUser()` and `logout()` functions. |

Estimated effort: **~30 min, ~1 file deleted, ~4 files simplified.**

### Step 5: Add LLM health indicator

Replace the user avatar / sign-out button in the header with a health
indicator showing Ollama connectivity and loaded model:

**Backend** — extend `/api/health` (or add `/api/health/llm`):

```typescript
app.get("/api/health", async (c) => {
  const base = { status: "ok", app_name: config.appName };
  try {
    const ollamaBase = config.llmBaseUrl.replace(/\/v1\/?$/, "");
    const res = await fetch(`${ollamaBase}/api/tags`);
    if (!res.ok) {
      return c.json({ ...base, llm: "error", detail: `HTTP ${res.status}` });
    }
    const data: unknown = await res.json();
    const models = Array.isArray((data as Record<string, unknown>)?.["models"])
      ? ((data as Record<string, unknown>)["models"] as Array<unknown>).length
      : 0;
    return c.json({ ...base, llm: "connected", models, defaultModel: config.llmDefaultModel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return c.json({ ...base, llm: "unreachable", detail: msg });
  }
});
```

**Frontend** — small status dot in the header:

- 🟢 Green dot + model name when Ollama is connected
- 🔴 Red dot + "LLM offline" when unreachable
- Poll `/api/health` every 30 seconds (or on mount + after errors)

This replaces the user info section that currently shows avatar + name +
sign-out button.

Estimated effort: **~30 min backend, ~30 min frontend.**

### Step 6: Update `.env.example` and documentation

Replace the old `.env.example`:

```bash
# LLM Configuration
# Base URL for the OpenAI-compatible inference API
VOXPILOT_LLM_BASE_URL=http://localhost:11434/v1
# API key (Ollama ignores this, but the OpenAI SDK requires a non-empty value)
VOXPILOT_LLM_API_KEY=ollama
# Default model to use for chat completions
VOXPILOT_LLM_DEFAULT_MODEL=qwen3-coder:32b
```

Update `ARCHITECTURE.md` to remove references to GitHub OAuth,
`gh_token` cookie, and GitHub Models. Document the new health indicator
and LLM config.

Estimated effort: **~15 min.**

---

## 5  What Changes vs. What Stays

### Stays the same

| Component | Why |
|---|---|
| **Agent loop logic** (`agent.ts`) | Tool-calling protocol is identical — Ollama uses the same `finish_reason: "tool_calls"` + `delta.tool_calls` streaming format |
| **Tool framework** (`tools/`) | Tools are LLM-agnostic; they execute locally regardless of provider |
| **SSE streaming** | Same event types, same flow |
| **Database schema** | Messages table is provider-agnostic |
| **Copilot ACP integration** | Independent subsystem; continues to work alongside |
| **Frontend components** | MessageBubble, ToolCallBlock, ReviewOverlay, etc. — all unchanged |

### Removed

| Component | Files | Why |
|---|---|---|
| **GitHub OAuth flow** | `routes/auth.ts`, `middleware/auth.ts`, `services/github.ts`, `tests/auth.test.ts` | Only existed to obtain `gh_token` for GitHub Models API |
| **Auth middleware** | `middleware/auth.ts`, references in `index.ts` | Routes become public (single-user self-hosted app) |
| **Login view** | `frontend/src/components/LoginView.tsx` | No authentication needed |
| **User signals** | `user`, `authChecked` in `store.ts` | No user identity to track |
| **GitHub config vars** | `VOXPILOT_GITHUB_CLIENT_ID`, `VOXPILOT_GITHUB_CLIENT_SECRET` in `config.ts` | No OAuth app needed |

### Added

| Component | Files | Why |
|---|---|---|
| **LLM config vars** | `config.ts`, `.env.example` | `llmBaseUrl`, `llmApiKey`, `llmDefaultModel` |
| **LLM health check** | `routes/health.ts` | Pings Ollama to report connectivity |
| **Health indicator** | `ChatView.tsx` header area | Replaces user avatar / sign-out with connection status |

---

## 6  Testing Strategy

### Unit tests

- Existing `agent.test.ts` tests continue to work (they mock the OpenAI
  SDK; the mock is provider-agnostic). Update to remove `ghToken` from
  test options.
- Remove `auth.test.ts` (deleted code).
- Update `chat.test.ts` — remove auth-related assertions, verify
  messages flow without `gh_token`.
- Add a health endpoint test that mocks Ollama responses (connected vs.
  unreachable).

### Integration testing

- Start Ollama locally with a small model (e.g. `qwen3-coder:7b` or
  `tinyllama`) for CI-like testing.
- Verify streaming, tool calling, and multi-turn conversation work
  end-to-end.

### Manual verification

- Open the app → should go directly to chat (no login screen).
- Verify the health indicator shows green + model name.
- Send a coding prompt → verify streamed response appears.
- Stop Ollama → verify health indicator turns red.
- Trigger a tool call (e.g. "read the README") → verify tool execution.

---

## 7  Setup Guide (for the RTX 4090 machine)

```bash
# 1. Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull the recommended model
ollama pull qwen3-coder:32b      # or the specific quantisation tag

# 3. Verify it's running
curl http://localhost:11434/api/tags

# 4. Configure VoxPilot
cat >> .env <<EOF
VOXPILOT_LLM_BASE_URL=http://localhost:11434/v1
VOXPILOT_LLM_API_KEY=ollama
VOXPILOT_LLM_DEFAULT_MODEL=qwen3-coder:32b
EOF

# 5. Start VoxPilot
just dev-backend
# Open http://localhost:8000 — no login required, starts chatting immediately
```

---

## 8  Code Deletion Summary

Removing the GitHub auth flow is a net code reduction. Here's the full
inventory of what gets deleted or simplified:

### Files deleted (4 files, ~150 lines)

| File | Lines | Purpose |
|---|---|---|
| `backend/src/routes/auth.ts` | ~67 | Login, callback, logout, /me routes |
| `backend/src/middleware/auth.ts` | ~17 | Cookie-based auth middleware |
| `backend/src/services/github.ts` | ~81 | OAuth token exchange, user fetch |
| `frontend/src/components/LoginView.tsx` | ~17 | GitHub sign-in view |

### Files simplified (estimated lines removed)

| File | Lines removed | Change |
|---|---|---|
| `backend/src/index.ts` | ~5 | Remove `authMiddleware`, `authRouter`, `protectedBase` |
| `backend/src/config.ts` | ~4 | Remove `githubClientId`, `githubClientSecret` |
| `backend/src/routes/chat.ts` | ~3 | Remove `AuthEnv`, `c.get("ghToken")`, `gh_token` from payload |
| `backend/src/routes/sessions.ts` | ~1 | Remove `AuthEnv` type param |
| `backend/src/routes/artifacts.ts` | ~1 | Remove `AuthEnv` type param |
| `backend/src/services/streams.ts` | ~1 | Remove `gh_token` from `MessagePayload` |
| `backend/src/services/agent.ts` | ~5 | Remove `ghToken` from options, remove `GITHUB_MODELS_BASE_URL` |
| `backend/src/schemas/api.ts` | ~5 | Remove `GitHubUser` schema |
| `frontend/src/App.tsx` | ~10 | Remove auth check, LoginView gating, user prop |
| `frontend/src/store.ts` | ~8 | Remove `user`, `authChecked` signals, `GitHubUser` re-export |
| `frontend/src/api-client.ts` | ~12 | Remove `fetchCurrentUser()`, `logout()` |
| `frontend/src/components/ChatView.tsx` | ~8 | Remove user prop, avatar, sign-out button |
| `backend/tests/auth.test.ts` | ~all | Delete entire test file |

**Net effect: ~5 files deleted, ~10 files simplified, ~200+ lines
removed, ~30 lines added (config + health check).** The codebase gets
significantly simpler.

---

## 9  Compatibility Notes

This is a **breaking change** — the GitHub OAuth flow is removed and
the app no longer requires (or supports) GitHub authentication.

| Scenario | Behaviour |
|---|---|
| Default config (no `.env` changes) | Connects to `http://localhost:11434/v1` with `ollama` key |
| `VOXPILOT_LLM_BASE_URL` set to vLLM/OpenRouter/etc. | Works with any OpenAI-compatible endpoint |
| Frontend loads | Goes directly to ChatView, no login screen |
| Ollama is down | Health indicator shows red; chat requests fail with clear error |

---

## 10  Future Enhancements (post-initial integration)

| Enhancement | Notes |
|---|---|
| **Model selector UI** | Dropdown in chat input querying Ollama's `/api/tags` for available models |
| **Model warm-up** | Pre-load the model on backend startup to eliminate first-request latency |
| **GPU monitoring** | Surface Ollama's GPU utilisation in the health endpoint |
| **Cloud fallback** | Optional cloud provider (OpenRouter, etc.) for when local GPU is busy |
| **Multiple models per session** | Let the user pick model per message |

---

## 11  Estimated Total Effort

| Step | Effort |
|---|---|
| LLM config in config.ts | 10 min |
| Remove GitHub auth (backend) | 45 min |
| Update agent.ts | 20 min |
| Remove GitHub auth (frontend) | 30 min |
| Add health indicator | 60 min |
| Update .env.example + docs | 15 min |
| Update tests | 30 min |
| **Total** | **~3.5 hours** |

Net code change: **~200+ lines deleted, ~80 lines added.** The codebase
gets simpler despite adding new functionality (health check).

---

## Locked Decisions (pending review)

| Decision | Choice | Rationale |
|---|---|---|
| Inference server | Ollama | Simplest setup, OpenAI-compatible API, built-in model management, auto VRAM management |
| Primary model | Qwen 3 Coder 32B (Q4) | Best coding benchmark scores, tool-calling support, fits in 24 GB VRAM |
| Integration pattern | OpenAI SDK baseURL swap | Zero changes to agent loop logic; provider is just config values |
| GitHub auth | **Remove entirely** | Only existed for GitHub Models API key; self-hosted app doesn't need authentication |
| Health indicator | Replace user avatar area | Frontend shows Ollama connectivity + model name instead of GitHub user info |
| Default config | Ollama at `localhost:11434` | Self-hosted is now the only supported mode; any OpenAI-compatible endpoint works via config |
