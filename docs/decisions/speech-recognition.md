# Speech recognition decisions

Accepted for the initial implementation, November 2026. This record explains the
choice; the [service contract](../../speech/CONTRACT.md),
[runtime documentation](../../speech/README.md) and
[deployment guide](../../packaging/SPEECH.md) own current behavior and setup.
Staging acceptance and production activation are separate deployment decisions.

## Decision

Use a standalone, supervised homelab service for completed-recording
transcription, initially through OpenAI `gpt-transcribe`. Keep the provider key
on that service, not on phones, static hosting or each coding backend.

VoxPilot records first and transcribes when the user finishes. The resulting
text enters the existing OpenCode prompt flow with numbered pasted items and
image attachments. Preserve an ordinary typing/correction path and the original
draft, session, backend and project ownership across asynchronous work.

There is **no separate LLM cleanup pass**. The receiving coding agent already has
conversation/code context and can handle recoverable formatting differences.
The recognition goal is faithful meaning and recognizable technical terms, not
polished prose or paste-ready code.

## Evidence and limitations

We compared the same public speech samples on an RTX 4090, the homelab's older
Xeon CPUs and OpenAI, then tested seven user recordings with application names,
custom driver terminology, hostnames and background music.

The strongest application finding was vocabulary biasing: all recognizers,
including OpenAI, missed some unfamiliar names without hints. One small shared
list derived from the recording labels—not the intended transcripts—recovered
the targeted names for Qwen, Whisper and OpenAI on the six newer clips. The
intended transcripts were reserved for evaluation, never supplied as answers.

On those clips, warmed processing medians with hints were roughly 0.25 seconds
for Qwen on the 4090, 0.19 seconds for Whisper on the 4090, and 0.97 seconds for
OpenAI including its network round trip. The tested Nemotron CPU configuration,
limited to four cores, took roughly 1.95 seconds without usable vocabulary
boosting. Its downloaded artifact lacked required tokenizer information; this
is a limitation of that tested configuration, not proof CPU ASR cannot work.

The 4090 is fast but is not guaranteed awake when working from another machine.
Cloud transcription avoids that dependency without requiring a new GPU. At the
then-published $0.0045/minute, it was about $0.27/hour; both passes on the six
new recordings cost about one cent. Prices and service policies are dated
observations and must be rechecked before revisiting the choice.

This was a small practical sample, not a statistically conclusive model ranking
or proof of superiority over Apple Dictation. Raw word-error scores also penalize
spoken “dot”/“at”, identifier spacing and spelling conventions that need not
change meaning. Judge names, negations, omissions/inventions and correction effort
alongside latency—not a single accuracy percentage.

## Vocabulary ownership

Use simple JSON arrays, with no per-term metadata:

- User vocabulary lives in that machine's user configuration directory.
- Shared project vocabulary lives in the active checkout and may be committed.
- Private project vocabulary lives in the canonical checkout and is ignored,
  so worktrees on that machine reuse it without putting work terms in Git.

Merge user → shared → private, deduplicating case-insensitively and preserving
the more-specific spelling. OpenCode supplies checkout/canonical paths;
metadata-aware caching avoids repeatedly parsing unchanged files. Coding agents
manage the files with normal file tools, following plugin-provided instructions.

The speech service receives only the effective terms for the request. It does
not own a project-vocabulary database or need access to repositories. Do not use
whole conversations, reference transcripts, raw code or clipboard contents as
automatic transcription context. Exact links and text belong in the numbered
paste items rather than depending on spoken character-perfect identifiers.

## Safety and privacy

Raw Whisper and a forced-English Qwen configuration invented text for synthetic
silence/noise controls. Whisper speech detection and Qwen auto language detection
eliminated those particular failures. This supports an acoustic speech-presence
guard, not a guarantee that hallucinations are solved in all conditions. Validate
quiet speech and realistic noise so guarding does not discard legitimate words.

Keep normal audio transient and do not collect it as benchmark data automatically.
Durable chat stores the admitted transcript as usual. Explicitly collected samples
and their per-recording cloud permissions are a separate workflow; personal audio
and full personal benchmark results do not belong in Git.

Bound uploads, decoded duration, processing resources, concurrency and replay
state. Authenticate the speech endpoint separately from the provider account.
Never compile provider keys into frontend assets or expose them through runtime
configuration. A browser-readable speech-only token still grants paid service use
and requires protected site/config access.

Do not automatically retry paid requests. Bounded in-memory replay reduces
duplicate attempts but is not durable exactly-once billing across expiry,
restarts or replicas. Cancellation cannot promise a provider refund. Avoid
logging credentials, audio or full transcripts.

## When to revisit

- Cloud price, privacy, retention, availability or acceptable-use requirements change.
- Real dictation shows recurring meaning-changing mistakes despite relevant vocabulary.
- Local runtimes improve enough to offer accurate, vocabulary-aware recognition on
  hardware that is reliably available, or offline operation becomes necessary.
- Vocabulary hints start forcing unspoken terms, or speech detection loses quiet words.

Qwen and Whisper remain credible local candidates; they are not required services
in the initial cloud deployment. Reuse identical consented recordings, record
model/runtime versions and settings, separate loading from warmed inference and
network latency, and keep evaluation references out of recognition context.

## Detailed research archive

Historical notes, reports, public benchmark outputs, scratch scripts and the
continuation handoff are preserved on **`archive/asr-research-2026-11`**, commit
**`f4a1744`** (initial snapshot `8391869`; later handoff edits also preserved).
Start with its `ARCHIVE.md`:

```sh
git show archive/asr-research-2026-11:ARCHIVE.md
```

The archive is a dated evidence snapshot, not current setup instructions or
maintained automation. Do not merge it wholesale into main. It excludes personal
recordings/results, credentials, runtime connection configs, weights and virtual
environments. The active checkout keeps only this concise rationale and the
maintained feature documentation.
