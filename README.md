# VoxPilot

Mobile-first coding UI for [OpenCode 2](https://opencode.ai/v2/docs/). VoxPilot
formats both versions of a file to the phone's character width **before**
computing the diff, including comment reflow.

## Architecture

- **Static frontend:** build once, serve on your Caddy host, connect to any host.
- **Native OpenCode plugin:** formatting RPCs, persistent review snapshots,
  `voxpilot_show_diff` agent tool, and desktop idle inhibition.
- **systemd service:** runs `opencode serve` directly via an `exec` launcher.
  OpenCode owns plugin lifecycle, HTTP authentication, API, and SSE.

There is no VoxPilot HTTP backend or MCP server. Plugin source and shared RPC
schemas live in `plugin/`; the frontend imports their inferred types.

## Development

Prerequisites: Bun, Node.js 22+, just, Git, native OpenCode 2.0.22, Ruff and
clang-format. Prettier is bundled. Provider configuration belongs to OpenCode.

```sh
cp .env.example .env
just install
just dev
```

Vite serves the frontend on port 3000 and proxies `/api` and `/auth` to OpenCode
on port 8001. Development uses the production launcher, including its standard
CORS origins, while overriding the plugin path to the source checkout. Open the
frontend and connect using its own URL and the development server password.
Alternatively, configure named servers and credentials in the Git-ignored
`frontend/config.local.json`; see `packaging/config.example.json` for the format.
Vite serves this runtime file without including it in production builds.
Rebuild the plugin and restart the development server after plugin edits.

```sh
just typecheck
just test       # formatter tests + real isolated OpenCode plugin integration
just test-e2e  # real dev backend; GPT-6 Luna for generated AI responses
just check     # typecheck, both test suites, and lint
just lint
just build     # plugin/dist and frontend/dist
scripts/build-release.sh bun-linux-x64
```

The release includes a host-install tarball and a separate architecture-independent
`voxpilot-frontend-<version>.tar.gz` for central static hosting. The existing
dev-setup installer can continue extracting the host tarball and restarting its
systemd unit. Runtime installation requires neither Bun nor npm.

## Voice composer

The composer starts in Voice mode without opening the keyboard. **Record →
Finish → transcribe → send** is the normal flow: finishing a message uses OpenAI
`gpt-transcribe` and submits through the existing chat prompt flow. There is no
per-recording checkbox, playback/download preview, test-sample control or mandatory
review step in the normal composer. No separate cleanup LLM is used.

Cancellation, explicit retry and Type/correction remain available. Audio is kept
only in memory for pending transcription/recovery and released when the draft is
sent, discarded or replaced. Silence is not submitted as chat text. Recordings
are limited to five minutes; reaching that limit finishes/sends. Backgrounding
the page cancels active capture rather than preserving a local-only clip.
Microphone capture needs HTTPS or localhost and MediaRecorder/Web Audio support.
Without a configured speech service, use Type. The standalone speech service
owns the OpenAI key; frontend and coding backends never receive it. See
[speech deployment](packaging/SPEECH.md) and [service contract](speech/CONTRACT.md).

Paste captures clipboard text or links as numbered pills. Tap a pill to inspect
the exact contents, or refer to its number while speaking. Removing one does not
renumber the others. If clipboard access is unavailable, Paste opens a native
paste field instead. Type opens the existing text composer; switching modes
preserves the draft, pasted items and image attachments. The selected mode is
remembered. Typed sends include pasted items labelled with their numbers.

### Speech vocabulary

Vocabulary is project-owned data, not a mutable file on the static frontend host.
Each file is a plain JSON array of canonical spellings. Missing files mean empty
lists; no timestamps, counts, provider settings or per-term metadata are stored.

| List | Location |
| --- | --- |
| User, on this machine | `$XDG_CONFIG_HOME/voxpilot/vocabulary.json`, default `~/.config/voxpilot/vocabulary.json` |
| Shared project | Active checkout's `.voxpilot/vocabulary.json` (committable) |
| Private project | Canonical checkout's `.voxpilot/vocabulary.local.json` (ignored) |

```json
["VoxPilot", "OpenCode", "SolidJS", "Zod"]
```

The plugin uses OpenCode's existing `project.directory` and `project.canonical`
metadata, so nested locations and worktrees need no Git subprocess lookup.
Lists merge user → shared → private, deduplicating case-insensitively while
preserving the most-specific spelling. Shared lists follow their checkout's
Git version; private lists are reused across that project's worktrees on the
same machine. Neither private nor user lists automatically sync across hosts.

The authenticated `vocabulary` RPC returns merged terms and their sources.
Parsed files are cached; filesystem identity, size and modification/change times
are checked per read so normal edits, atomic replacements and deletion take
effect without a restart. Invalid files fail clearly instead of silently using
stale words. Aim for 20–30 relevant terms total. Files are bounded to 100 terms,
120 characters per term, and 64 KiB; symlink files/directories and control
characters or angle brackets are rejected.

The plugin injects a short agent-loop instruction explaining how to manage
these files with normal file-editing tools—no vocabulary MCP tools or global
`AGENTS.md` changes. For project requests, an existing shared list is used unless
private changes are requested; without a shared list, the default is private.
User-wide changes require an explicit request such as "on this machine, across
all projects". The list contents are data, never injected as agent instructions.
Git visibility is separate from permission to send vocabulary to a cloud model.

Install the private-file pattern in each host user's global Git ignore file:

```sh
python3 scripts/install-vocabulary-ignore.py --dry-run
python3 scripts/install-vocabulary-ignore.py
```

The helper appends only `/.voxpilot/vocabulary.local.json`, preserving existing
patterns, symlinks and `core.excludesFile` configuration. It does not ignore
the shared file or remove other existing patterns. `VOXPILOT_USER_VOCABULARY_FILE`
can override the user list with an absolute path; test servers use this to keep
test agents away from real user vocabulary.

Transcription snapshots the original project's effective vocabulary. Context is
bounded to 30 terms / 2000 characters. Vocabulary is checked when the project
loads; invalid or over-budget lists show a persistent composer error and disable
recording before microphone capture. Shorten/fix the files, then use **Refresh
vocabulary** (or reload the project). Type remains usable. Vocabulary is checked
again before upload to catch edits made during recording; no terms are silently
dropped and there is no subset picker.

## Personal frontend deployment

The frontend is deployed independently of the homelab tenant image. From a
LAN-connected machine with Python 3.12+:

```sh
just deploy-frontend                     # latest published GitHub release
just deploy-frontend '0.1.298+5951fb8'    # a specific release, including rollback
python3 scripts/deploy-frontend.py --release latest --dry-run
python3 scripts/deploy-frontend.py --directory frontend/dist
```

The deploy script verifies the release artifact's SHA-256 checksum, uploads
content-hashed assets first, and publishes `index.html` last using WebDAV
MOVE. It retains old assets for open tabs and refuses to overwrite an existing
asset with different content. Run only one deployment at a time. No SSH,
Caddy reload, tenant rebuild, or plugin restart is involved. Frontend-only
deployment does not update the native plugin; changes to the RPC contract may
also require updating the connected OpenCode hosts.

The default write destination is `https://push.apps.lasath.com/voxpilot/`;
read-back verification uses `https://static.apps.lasath.com/sysupdate/voxpilot/`.
The write endpoint is LAN-only and unauthenticated. Do not expose it to the
public Internet. `--push-url` and `--read-url` can select another host, but must
end in `/voxpilot`. Never publish `config.json`: the homelab's separate runtime
credential route owns it.

Homelab Caddy serves this directory at `https://voxpilot.apps.lasath.com/`.
The first hosting-route change must be applied separately; uploading assets
alone does not switch an existing image-baked frontend. Published files live
on versioned `/srv`: they survive reboots and carry forward with tenant
updates, but OS rollback can restore an older frontend. There is no baked
frontend fallback on a fresh installation; publish assets before enabling
the route.

See [deployment instructions](packaging/README.md),
[architecture](ARCHITECTURE.md), and [browser tests](frontend/e2e/README.md).
