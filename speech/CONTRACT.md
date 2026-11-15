# Speech service protocol 1

The single executable runs independently of static hosting and OpenCode. Its
browser-safe Zod contract is `plugin/src/speech-contract.ts`. Both service and
frontend import it; no duplicated DTOs or project vocabulary database.

## Routing and authentication

The browser first reads vocabulary through its captured, authenticated OpenCode
client and original session/project directory. It then calls the speech service
directly. Caddy can expose the service under a same-origin `/speech` prefix
(stripped before forwarding), or a dedicated HTTPS hostname. A deployment-owned
`config.json` may contain optional `speech: {url, token}`. This token grants
speech-service access only; it is not an OpenAI or OpenCode credential. It stays
in browser memory, never localStorage, URLs or compiled assets. The OpenAI key
is readable only by the speech process from its private credential file.

Every API operation requires `Authorization: Bearer <speech token>`. Requests
with Origin must match an exact configured allowlist; credentialed cookies,
wildcard CORS, redirects and credential forwarding to OpenAI are prohibited.
Unauthenticated health checks expose no configuration or credential detail.

- `GET /v1/capabilities`: authenticated capability/readiness response.
- `POST /v1/transcriptions`: multipart `audio` binary and `metadata` JSON.
- `DELETE /v1/transcriptions/:id`: explicit cancellation, including a bounded
  tombstone if cancellation races upload. Aborting browser fetch also stops local
  processing; cancellation cannot promise refunds once OpenAI starts processing.

## Limits, privacy and retries

Only OpenAI `gpt-transcribe` is available initially. The user has authorized normal
voice dictation to use it without a per-recording checkbox. Record/Finish is a
transcription-and-chat action, not a local-only recording workflow. The frontend
attests that choice with `provider: "openai", cloudAllowed: true`; the service
still rejects absent/false cloud permission in its protocol.
Only audio and its vocabulary snapshot are sent; no cleanup LLM pass.
Audio is processed in bounded memory/runtime tmpfs and is not retained. Completed
transcripts and request fingerprints may be cached in memory for 15 minutes
solely to deduplicate retries. Pending IDs never expire while work is active.
Same ID/body replays the cached outcome without another paid call; a different
body with the same ID conflicts. Failures are cached too. Explicitly starting a
new paid attempt uses a new ID and explicit confirmation in the recovery controls.
No service or browser automatic paid retries.

Recovery controls follow the returned error classification. Temporary refusals
(`busy`, `rate_limited`, `unavailable`) allow an explicit same-ID retry. An
unconfirmed upload or cancellation offers **Recover transcription** using the
original ID/body. Cached terminal failures and confirmed cancellations do not
offer a futile same-ID retry; another attempt requires a new ID and confirmation.
Warnings use `providerMayHaveProcessed` to explain possible previous charges.
Invalid audio or authorization requires fixing the input/configuration instead.
Once the browser's replay window expires, it also requires a new attempt.

Bounds: 10 MiB, 300 decoded seconds, at most two active jobs, bounded request
rate and replay cache. Actual decoded duration is checked, not trusted from the
browser. An acoustic speech-presence guard runs before cloud upload; silence
returns `no_speech` and is never submitted as a chat message. It is not a
guarantee against all background speech/noise or ASR inventions.

At most 30 canonical terms and 2000 total characters. If the merged vocabulary
exceeds this budget, show a persistent project error and disable recording until
the vocabulary files are shortened and refreshed; never silently truncate.
Malformed source vocabulary also blocks recording. Recheck before upload in case
files changed during recording. OpenAI receives `keywords[]`;
auto language detection is used (no obsolete singular `language` parameter).

Errors use the shared safe envelope; never include upstream bodies, tokens,
audio, transcription content or vocabulary in logs. Chat submission captures the
original draft/session/backend before awaits, checks ownership after awaits,
preserves content on error/cancel, and consumes only an accepted snapshot.
