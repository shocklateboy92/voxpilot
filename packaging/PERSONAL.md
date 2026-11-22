# Personal deployment

## Publish the release

1. Commit the changes and push to GitHub, normally on `master` unless another
   branch was requested. A push to `master` triggers the
   [Release workflow](../.github/workflows/release.yml) automatically. For another
   branch, push it and dispatch the workflow with
   `gh workflow run release.yml --ref <branch>`.
2. Wait for the Release workflow for that commit to succeed. Check that the
   [latest GitHub release](https://github.com/shocklateboy92/voxpilot/releases/latest)
   was built from the intended commit before deploying; both default deploy
   commands fetch `latest`, not the local checkout. A manually dispatched
   release is also marked as `latest`.

## Frontend (homelab)

The frontend is deployed independently of the homelab tenant image. From a
LAN-connected machine with Python 3.12+, run from the VoxPilot checkout:

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

## Backend (local OpenCode host)

On the machine running `voxpilot.service` (normally this machine), run the
[dev-setup bootstrap](https://github.com/shocklateboy92/dev-setup#install) as the
user that owns the service. No dev-setup checkout is required. This runs the
full dev-setup profile, which installs the latest VoxPilot release and restarts
`voxpilot.service`. If updating both components, do this last: the restart can
terminate the OpenCode session that launched the deployment.

Start the **entire pipeline** inside a detached systemd user service so it
keeps running after the session is killed:

```sh
systemd-run --user --collect --unit=voxpilot-backend-deploy \
  --property=SyslogIdentifier=voxpilot-backend-deploy \
  /bin/bash -o pipefail -c 'curl -fsSL https://setup.lasath.dev | bash'
```

After reconnecting, check the installer log and verify that `voxpilot.service`
is active and the installed version matches the intended release:

```sh
journalctl --user -t voxpilot-backend-deploy -n 100 --no-pager
systemctl --user status voxpilot.service --no-pager
cat ~/.local/share/voxpilot/VERSION  # adjust if VOXPILOT_ROOT is customized
```

See also [host setup and manual installation](README.md).
