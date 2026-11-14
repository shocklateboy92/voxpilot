# Standalone speech service deployment

Speech is a separate supervised homelab service. It is not installed into coding
backends or the static frontend. The active test deployment is on chapel;
shared host-neutral configuration is deployed through the normal tenant image.

## Credentials

Development uses `~/.config/voxpilot/credentials/openai-api-key`: directory 0700,
file 0600, outside the checkout. The speech process accepts `OPENAI_API_KEY_FILE`,
not a direct key environment variable. Never put the key in a command argument,
frontend `config.json`, logs, a build context, project vocabulary or OpenCode config.

The operator provisions chapel's existing key with:

```sh
python3 scripts/provision-speech-credential.py
```

From sisko this same least-privilege invocation is possible without exposing
another host resource or granting SSH access:

```sh
incus exec dev2 -- python3 /home/fernie/src/voxpilot/scripts/provision-speech-credential.py
```

The helper streams the private file directly to chapel's `systemd-creds encrypt
--with-key=host --name=voxpilot-speech-openai-key`; it emits no plaintext. It saves
chapel-bound ciphertext in the homelab host credstore and under
`/var/lib/voxpilot-speech/credentials/openai.cred` for runtime iteration. It refuses
existing ciphertext rather than silently rotating or overwriting it. No mccoy
or medbay access is involved. Use the owning homelab `SERVICES.md` secret workflow
for deliberate rotation or future production provisioning.

The independent `voxpilot-speech-token` is generated through chapel's encrypted
random-secret oracle. Only the speech service and browser-config generator
consume it. The generator does **not** load the OpenAI credential. A protected,
no-store frontend runtime config advertises:

```json
{
  "servers": ["existing server entries, unchanged"],
  "speech": {
    "url": "https://speech.staging.lasath.com",
    "token": "a deployment-owned speech-only bearer token"
  }
}
```

The token is intentionally browser-readable and grants paid speech-service calls;
protect site/config access as carefully as backend passwords. It never grants
OpenAI account access and is never compiled into assets or stored by the frontend.

## Chapel iteration

Read `/home/fernie/src/homelab/AGENTS.md` and
`mkosi.images/tenant/SERVICES.md` before infrastructure changes. Source Quadlet,
non-secret env, Caddy snippet, token-only config unit and encrypted credentials
are owned there. The durable source uses each host's DNS, credentials and origin
allowlist. The staging helper adds `ConditionHost=chapel` and always overrides the
image reference to the staging registry; it never accesses production.

```sh
python3 scripts/deploy-speech-staging.py --build
```

This helper verifies `uname -n == chapel`; uploads a source-only whitelist (not
the whole checkout); builds/pushes only to `registry.staging.lasath.com`; pins the
runtime image digest; then installs `/run` Quadlet/env/Caddy/config overrides.
It restarts only the new speech service/config unit and reloads Caddy. It neither
restarts OpenCode ports 2096/8001 nor touches the frontend Vite process. It adds
the speech token to the existing development preview config without changing
backend entries. Plaintext key material is loaded only into the speech unit's
systemd runtime credential directory, idmapped read-only to UID 65532.

The service has a read-only root, no capabilities, no host-published port,
no recording/data mount, CPU quota 200%, 512 MiB memory, no swap/core dumps and
a process limit. Caddy bounds requests to 11 MiB; the service imposes stricter
audio/metadata/duration/rate/concurrency bounds. Health probes use the executable's
`healthcheck` command without credentials. See `speech/README.md` for runtime
configuration and acoustic-guard limitations.

The preview remains at **https://voxpilot-dev.staging.lasath.com**. Config changes
require a browser reload. Do not print/fetch runtime config into tool transcripts.
Never call `caddy-merge-sites` live: the helper copies only the speech snippet
into the already bind-mounted `merged.d`, then sources Caddy's credential envfile
inside its container and validates/reloads without displaying it.

`/run` overrides survive process restarts, **not chapel reboots**. Reapply the
helper after a reboot once the existing HTTPS frontend preview is available.
The service is always-on under systemd, not a per-request process or background
shell. The homelab source files provide the normal immutable-image rollout path;
after a new build, deliberately update their pinned `Image=` to the printed
staging digest. No image rollout/reboot or production promotion is implicit.

## Normal tenant-image rollout

Mccoy's production OpenAI key and separate speech token are sealed in homelab's
`hosts/mccoy/credstore.encrypted/` with the same credential names as chapel. The
shared Quadlet uses `%H` for credential/origin files; the config generator and
Caddy use host `DNS`. The system preset enables token-only config generation at
boot. No production `/run` bundle is required.

The tested speech app image must exist in the production container registry before
booting a tenant image that references it. Its digest is preserved when copied:

```sh
skopeo copy --preserve-digests \
  docker://registry.staging.lasath.com/voxpilot-speech@sha256:07f99d8d1d8b8d1cd03ce2d5d7ea88696c76cb6177b06422bf1250aaa1b0e29e \
  docker://registry.apps.lasath.com/voxpilot-speech:0.1.0
```

This specific registry copy was explicitly authorized by the user. It does not
grant production SSH or OS-image publication access. Tenant rollout follows the
owning homelab guide:

```sh
cd ~/src/homelab
sudo -E mkosi --profile tenant -f build
./publish.sh tenant
ssh root@chapel 'updatectl update && systemctl reboot'
```

Verify chapel's `IMAGE_VERSION`, speech service, boot-generated frontend config,
and HTTPS endpoint without reapplying speech overrides. After staging acceptance,
the operator promotes that exact tenant version and updates mccoy:

```sh
./promote.sh <verified-version>
ssh root@mccoy 'updatectl update && systemctl reboot'
```

The coding API hosts also need the updated plugin with `vocabulary` RPC. Use the
normal VoxPilot release/install workflow for those dedicated APIs, preserving
their provider configuration/databases. Do not restart the conversation-owning
OpenCode service on port 2096.

Verified tenant version: **2026-11-14-1642-668586c-dirty**. It was built and
checksum-verified from the homelab working tree, published to the chapel channel,
and booted on chapel through normal `updatectl`/reboot. Speech and token-only
browser config started from `/etc` with zero speech restarts and no speech
`/run` overrides. Authenticated HTTPS and the synthetic browser recording →
OpenAI → native chat test both passed after reboot.

The speech container was copied to `registry.apps.lasath.com/voxpilot-speech:0.1.0`
with its original digest. The development preview's separate `/run` Caddy/config
files were backed up under `/var/lib/voxpilot-preview` and restored after the
staging reboot; those are preview-only, not speech-service overrides.

After the service and coding plugins are ready, publish the built frontend through
the existing scoped publisher:

```sh
python3 scripts/deploy-frontend.py --directory frontend/dist
```

Publishing or a formal commit/tag remains a separate explicit action. Verify a real message at
`https://voxpilot.apps.lasath.com`; the service health check is
`https://speech.apps.lasath.com/healthz`.

## Verify

```sh
ssh -o BatchMode=yes root@chapel 'test "$(uname -n)" = chapel && systemctl is-active homelab-voxpilot-speech.service'
curl --fail https://speech.staging.lasath.com/healthz
just typecheck
just test
just lint
python3 scripts/test_provision_speech_credential.py
```

Provider/service tests use synthetic audio and injected provider functions; they
never read actual keys or make paid calls. Browser regressions use isolated
OpenCode backends and mocked speech responses. The real staging browser smoke
uses locally synthesized speech, not retained personal recordings.
Silence must return `no_speech` without a cloud
call; transcription replays should use the same ID/body and must not make another
paid attempt. There is no sample-storage endpoint in the coding plugin.

Cache is bounded and memory-only (15 minutes), so restart/replica/expiry replays
may be new paid attempts. No automatic paid retries exist. Cancellation cannot
promise a provider refund. Do not close the continuation Todoist goal until the
user confirms real recording → transcription → chat works end to end.

Latest staging validation: 163 ordinary browser regressions, 115 plugin tests,
31 speech-service tests and 14 Python helper tests passed, along with typechecks,
lint and builds. The explicit synthetic-audio staging browser smoke passed real
MediaRecorder → chapel/OpenAI → isolated native chat → assistant response with
the checkbox-free, preview-free productivity composer.
Physical phone capture/user acceptance remains separate.
