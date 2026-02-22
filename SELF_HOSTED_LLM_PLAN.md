# Self-Hosted LLM Integration Plan

> **Status: Plan — awaiting review.**
> Move the primary AI off GitHub Models onto a self-hosted inference
> server running on the local RTX 4090 (24 GB VRAM).

---

## Motivation

VoxPilot currently sends every LLM request to the GitHub Models API
(`models.inference.ai.azure.com`) using the user's GitHub OAuth token as
the API key. This works, but:

1. **Latency** — round-trip to Azure adds 200–500 ms on top of
   inference time.
2. **Privacy** — all code context leaves the local network.
3. **Cost / rate limits** — GitHub Models has token-per-minute caps that
   throttle long agentic runs.
4. **Model choice** — limited to the models GitHub exposes.

A self-hosted inference server on the local RTX 4090 eliminates all four
issues and aligns with VoxPilot's "self-hosted" identity.

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
Frontend → POST /api/sessions/{id}/messages { content, model: "gpt-4o" }
         → agent.ts → new OpenAI({ baseURL: GITHUB_MODELS, apiKey: ghToken })
         → models.inference.ai.azure.com
```

### Proposed flow

```
Frontend → POST /api/sessions/{id}/messages { content, model: "qwen3-coder:32b" }
         → agent.ts → new OpenAI({ baseURL, apiKey })
                       ↑ resolved from config: local Ollama or GitHub Models
         → localhost:11434  (self-hosted)
      OR → models.inference.ai.azure.com  (fallback/cloud)
```

The key insight is that Ollama's `/v1/chat/completions` endpoint is
wire-compatible with the OpenAI SDK. **The agent loop (`agent.ts`) does
not need to change its core logic.** Only the client construction needs
to be parameterised.

---

## 4  Implementation Steps

### Step 1: Add provider configuration to `config.ts`

Add new environment variables:

```
VOXPILOT_LLM_PROVIDER=ollama          # "ollama" | "github" | "custom"
VOXPILOT_LLM_BASE_URL=http://localhost:11434/v1
VOXPILOT_LLM_API_KEY=ollama           # Ollama ignores this, but SDK requires it
VOXPILOT_LLM_DEFAULT_MODEL=qwen3-coder:32b
```

Update the Zod config schema:

```typescript
llmProvider: z.enum(["ollama", "github", "custom"]).default("github"),
llmBaseUrl: z.string().default(""),
llmApiKey: z.string().default(""),
llmDefaultModel: z.string().default("gpt-4o"),
```

**Backward-compatible**: defaults to `github` provider, preserving
current behaviour for users who haven't set up Ollama.

Estimated effort: **~15 min, ~20 lines changed.**

### Step 2: Create a provider resolver in `agent.ts`

Extract the OpenAI client construction into a helper:

```typescript
function createLlmClient(config: Config, ghToken?: string): OpenAI {
  switch (config.llmProvider) {
    case "ollama":
      return new OpenAI({
        baseURL: config.llmBaseUrl || "http://localhost:11434/v1",
        apiKey: config.llmApiKey || "ollama",
      });
    case "custom":
      return new OpenAI({
        baseURL: config.llmBaseUrl,
        apiKey: config.llmApiKey,
      });
    case "github":
    default:
      if (!ghToken) throw new Error("GitHub token required for github LLM provider");
      return new OpenAI({
        baseURL: "https://models.inference.ai.azure.com",
        apiKey: ghToken,
      });
  }
}
```

Note: `ghToken` is optional because self-hosted providers don't need it.
The `github` case validates its presence at runtime.

In `runAgentLoop`, replace the inline `new OpenAI(...)` with a call to
this helper. Also move the client construction **outside** the
per-iteration loop (it's stateless; creating it once is fine).

Resolve the model name: use `opts.model` if provided, otherwise fall
back to `config.llmDefaultModel`.

Estimated effort: **~30 min, ~30 lines changed.**

### Step 3: Update `SendMessageRequest` and default model

In `schemas/api.ts`, change the default model:

```typescript
export const SendMessageRequest = z.object({
  content: z.string(),
  model: z.string().optional(),  // Remove hardcoded default; resolve from config
});
```

In `routes/chat.ts`, resolve the model at send time:

```typescript
model: body.model ?? config.llmDefaultModel,
```

This lets the frontend omit the model field and get the server's
configured default.

Estimated effort: **~10 min, ~5 lines changed.**

### Step 4: Update `.env.example` and documentation

Add the new env vars to `.env.example` with clear comments:

```bash
# LLM Provider: "ollama" for self-hosted, "github" for GitHub Models, "custom" for any OpenAI-compatible endpoint
VOXPILOT_LLM_PROVIDER=ollama
VOXPILOT_LLM_BASE_URL=http://localhost:11434/v1
VOXPILOT_LLM_API_KEY=ollama
VOXPILOT_LLM_DEFAULT_MODEL=qwen3-coder:32b
```

Update `ARCHITECTURE.md` to reflect the new provider abstraction.

Estimated effort: **~15 min.**

### Step 5: (Optional) Health check for local provider

Add an Ollama connectivity check to the existing `/api/health` endpoint
or a new `/api/health/llm` endpoint:

```typescript
// Ping Ollama to verify it's running
try {
  const res = await fetch(`${config.llmBaseUrl.replace("/v1", "")}/api/tags`);
  if (!res.ok) {
    return c.json({ status: "degraded", llm: "unreachable", detail: `HTTP ${res.status}` }, 200);
  }
  const data = await res.json();
  return c.json({ status: "ok", llm: "connected", models: data.models?.length ?? 0 }, 200);
} catch (err) {
  const msg = err instanceof Error ? err.message : "unknown error";
  return c.json({ status: "degraded", llm: "unreachable", detail: msg }, 200);
}
```

This gives the frontend a way to show whether the local LLM server is
reachable.

Estimated effort: **~20 min, ~15 lines.**

### Step 6: (Optional) Frontend model selector

The frontend currently hardcodes `model: "gpt-4o"` in the message
submission. Two options:

- **Minimal**: Remove the hardcoded model from the frontend; let the
  backend resolve via config. No UI change needed.
- **Enhanced**: Add a model dropdown in the chat input area that queries
  Ollama's `/api/tags` endpoint (via a backend proxy) to list available
  models.

The minimal approach is recommended for the initial integration.

Estimated effort: **Minimal: ~5 min. Enhanced: ~2 hours.**

---

## 5  What Does NOT Need to Change

| Component | Why |
|---|---|
| **Agent loop logic** (`agent.ts`) | Tool-calling protocol is identical — Ollama uses the same `finish_reason: "tool_calls"` + `delta.tool_calls` streaming format |
| **Tool framework** (`tools/`) | Tools are LLM-agnostic; they execute locally regardless of provider |
| **SSE streaming** | Same event types, same flow |
| **Database schema** | Messages table is provider-agnostic |
| **Frontend** (aside from model default) | All rendering, streaming, artifact handling unchanged |
| **Copilot ACP integration** | Independent subsystem; continues to work alongside |
| **Auth flow** | GitHub OAuth still needed for the app itself; just not used as LLM API key when provider is `ollama` |

---

## 6  Testing Strategy

### Unit tests

- Test `createLlmClient()` returns correct baseURL/apiKey for each
  provider setting.
- Existing `agent.test.ts` tests continue to work (they mock the OpenAI
  SDK; the mock is provider-agnostic).

### Integration testing

- Start Ollama locally with a small model (e.g. `qwen3-coder:7b` or
  `tinyllama`) for CI-like testing.
- Verify streaming, tool calling, and multi-turn conversation work
  end-to-end.

### Manual verification

- Send a coding prompt → verify streamed response appears in UI.
- Trigger a tool call (e.g. "read the README") → verify tool execution
  and result display.
- Switch between `ollama` and `github` providers via env var → verify
  both work.

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
VOXPILOT_LLM_PROVIDER=ollama
VOXPILOT_LLM_BASE_URL=http://localhost:11434/v1
VOXPILOT_LLM_API_KEY=ollama
VOXPILOT_LLM_DEFAULT_MODEL=qwen3-coder:32b
EOF

# 5. Start VoxPilot
just dev-backend
```

---

## 8  Migration Path and Backward Compatibility

| Scenario | Behaviour |
|---|---|
| No `VOXPILOT_LLM_*` env vars set | Defaults to `github` provider → existing behaviour unchanged |
| `VOXPILOT_LLM_PROVIDER=ollama` | Uses local Ollama; GitHub token still needed for app auth but not for LLM |
| `VOXPILOT_LLM_PROVIDER=custom` | Uses any OpenAI-compatible endpoint (e.g. vLLM, OpenRouter, Together AI) |
| Frontend sends `model` in request | Used as-is (user override) |
| Frontend omits `model` | Server resolves from `VOXPILOT_LLM_DEFAULT_MODEL` |

This design means:
- **Zero breaking changes** for existing users.
- **One config change** to switch to self-hosted.
- **Future-proof** — any OpenAI-compatible provider works via `custom`.

---

## 9  Future Enhancements (post-initial integration)

| Enhancement | Notes |
|---|---|
| **Model routing** | Use a fast local model for tool-heavy iterations, cloud model for complex reasoning |
| **Automatic fallback** | If Ollama is unreachable, fall back to GitHub Models |
| **Model warm-up** | Pre-load the model on backend startup to eliminate first-request latency |
| **GPU monitoring** | Surface Ollama's GPU utilisation in the health endpoint |
| **Multiple providers per session** | Let the user pick provider+model per message |

---

## 10  Estimated Total Effort

| Step | Effort |
|---|---|
| Config schema update | 15 min |
| Provider resolver in agent.ts | 30 min |
| Default model resolution | 10 min |
| .env.example + docs | 15 min |
| Health check (optional) | 20 min |
| Testing | 30 min |
| **Total** | **~2 hours** |

The entire change is **< 100 lines of code** across 4–5 files, with
zero changes to the agent loop logic, tool framework, or frontend
components.

---

## Locked Decisions (pending review)

| Decision | Choice | Rationale |
|---|---|---|
| Inference server | Ollama | Simplest setup, OpenAI-compatible API, built-in model management, auto VRAM management |
| Primary model | Qwen 3 Coder 32B (Q4) | Best coding benchmark scores, tool-calling support, fits in 24 GB VRAM |
| Integration pattern | OpenAI SDK baseURL swap | Zero changes to agent loop logic; provider is just a config value |
| Auth when self-hosted | GitHub OAuth for app, not used for LLM | Clean separation; LLM provider has its own (or no) auth |
| Default provider | `github` (backward-compatible) | Existing users unaffected |
