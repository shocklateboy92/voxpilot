# VoxPilot standalone speech service

An always-on Bun HTTP process, independent of OpenCode and static hosting. It
imports the browser-safe Zod protocol from `../plugin/src/speech-contract.ts`.
See [CONTRACT.md](CONTRACT.md) for the finalized wire contract.

## Build and run

Prerequisites: Bun (tested locally on 1.4.2), ffmpeg on `PATH`, and the shared contract source. Tests also
use `espeak-ng` to synthesize speech locally; no real recordings or credentials
are needed. Install prerequisites with the operating system's native package
manager. No machine or infrastructure deployment is performed by this package.

```sh
cd speech
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run build
```

`dist/voxpilot-speech` is a compiled Bun executable with the small WebRTC VAD
WASM asset bundled inside. It needs ffmpeg at runtime, but not Bun or node_modules.
The executable is built for the current host architecture. The Containerfile
builds the same artifact inside a Debian-based image (repository root context).
Distribute `dist/THIRD_PARTY_NOTICES.md` alongside the executable.

Required service-only configuration:

| Variable | Meaning |
| --- | --- |
| `SPEECH_ALLOWED_ORIGINS` | JSON array of exact browser origins, e.g. `["https://voxpilot.example.com"]`; no paths, trailing slashes, wildcard or `null` |
| `SPEECH_TOKEN_FILE` | Absolute private file containing a 32–256 character speech-only bearer token |
| `OPENAI_API_KEY_FILE` | Absolute private file containing the OpenAI key |
| `CREDENTIALS_DIRECTORY` | Alternative to explicit paths: systemd credentials named `speech-token` and `openai-key` |
| `SPEECH_HOST` | Bind address; default `127.0.0.1` (set `0.0.0.0` in a container behind a proxy) |
| `SPEECH_PORT` | Listen port; default `8789` |
| `SPEECH_FFMPEG` | ffmpeg executable path/name; default `ffmpeg` |

Direct `OPENAI_API_KEY` / `SPEECH_TOKEN` environment values are deliberately not
supported. Credential files must be regular files, not symlinks, owned by the
service UID or root, with no group/other permissions, and at most 4096 bytes.
Only the service reads them. Startup failures log a fixed sanitized message.
Never place keys in browser config, command arguments, URLs, images, or builds.

Terminate with SIGTERM/SIGINT to abort jobs and close the server. `/healthz` is an
unauthenticated fixed `ok` liveness check; `/v1/capabilities` requires auth and
reports readiness. Missing credentials/VAD/ffmpeg prevent startup. Readiness is
local configuration readiness, not a paid OpenAI availability probe.

## Safety and limits

- Exact-origin CORS; no cookies or wildcard credentials. A validated OPTIONS
  preflight does not require bearer auth (browsers do not send it). Every real API
  operation requires timing-safe SHA-256 bearer verification before body reads.
- At most two uploading bodies and two active decode/provider jobs. A pending
  replay shares its logical job and does not consume another paid job slot.
- 10 MiB audio, with at most 64 KiB additional multipart overhead and 16 KiB
  metadata. Streams are counted even with missing or misleading Content-Length.
  The exact field set is `audio` plus `metadata`; no extra or duplicate fields.
- ffmpeg reads/writes pipes only (protocol allowlist `pipe`), uses the declared
  format's pinned demuxer, produces decoded mono 16 kHz PCM, and rejects any
  decoded sample beyond 300 seconds. No audio files are written to disk.
- WebRTC/libfvad (BSD-3-Clause WASM, about 38 KiB package) aggressive mode plus
  a quiet-input energy floor and minimum voiced run guards against digital
  silence, quiet noise and transients. It is intentionally conservative: very
  quiet/short speech may be rejected, and background speech or some noise may
  pass. It is not a guarantee against ASR hallucinations.
- Global shared-token token buckets: 60 authenticated operations/minute,
  6 uploads/minute, 12 cancellations/minute, with these burst capacities.
  These limits intentionally do not trust proxy/IP forwarding headers.
- Up to 128 in-memory IDs, fixed 15 minutes after processing finishes, including
  successful/no-speech/failure/cancellation outcomes. No early eviction: a full
  cache rejects new IDs rather than permitting duplicate paid retries. Pending
  IDs never expire. Cancellation before an upload creates a bounded tombstone.
  Reusing an ID with changed validated metadata or audio returns `id_conflict`.
  Malformed bodies rejected before a trustworthy ID/fingerprint exists cannot
  create cache entries. Replays still count toward request/upload rate limits.
- All processing is bounded to approximately 120 seconds. DELETE or request
  disconnect aborts ffmpeg/provider fetch; an aborted provider attempt is marked
  `providerMayHaveProcessed`. Disconnect propagation depends on Bun and the
  reverse proxy; explicit DELETE is the reliable cancellation channel. Already
  completed outcomes are unchanged by a later DELETE. Cancellation is not a
  promise of a provider refund.
- Exactly one fetch to the fixed OpenAI audio/transcriptions endpoint using
  `gpt-transcribe` and `keywords[]`, auto language detection, no cleanup pass,
  redirect following, upstream error logging, or automatic retries. Responses
  are bounded/validated. An explicit paid retry must use a new ID.
- Audio/transcripts/vocabulary/upstream bodies are never logged. Only bounded
  transcripts/fingerprints remain in memory for deduplication, never on disk.
  The cache is not durable across restarts or replicas: use one always-on
  instance, and treat retries after restart as potentially new paid attempts.

Production should put this process behind HTTPS with reverse-proxy request
limits and process/container resource limits. Avoid proxy buffering if prompt
disconnect cancellation matters. Run as a dedicated non-root user, and disable
core dumps/swap or provide a suitable memory-only runtime policy. Native ffmpeg
parses untrusted media; keep the runtime package updated and sandbox the process.

The unit/network tests inject provider functions. Acoustic tests use generated
silence/noise/clicks and local synthesized speech encoded as WAV/WebM/Ogg/MP4.
No tests make real provider network requests or use actual user credentials/audio.
