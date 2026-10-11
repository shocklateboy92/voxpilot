# Deploy VoxPilot

One static frontend can connect to multiple OpenCode hosts. Each host runs only
OpenCode, with the bundled VoxPilot plugin loaded by the service.

## API host prerequisites

- Native `opencode` 2.0.22 on the systemd user's PATH.
- Git; Ruff for Python; clang-format for C/C++. Prettier is bundled.
- Provider credentials/configuration in the normal OpenCode configuration.

## Install or upgrade the host service

Extract `voxpilot-<version>-linux-<arch>.tar.gz` into `~/.local/share`. It contains:

```
voxpilot/
  bin/voxpilot-opencode       exec launcher
  plugins/voxpilot/           bundled native plugin
  static/                    optional copy of frontend assets
  systemd/voxpilot.service
  VERSION
```

Configure `~/.config/voxpilot/service.env` (systemd syntax, no `export`):

```ini
VOXPILOT_HOSTNAME=0.0.0.0
VOXPILOT_PORT=8000
# Optional additional frontend origin; standard lasath.com origins are built in.
# VOXPILOT_ORIGIN=https://voxpilot.apps.example.com
OPENCODE_PASSWORD=your-server-password
# VOXPILOT_WAKE_URL=https://your-home-assistant-webhook
```

The bind address defaults to all interfaces for a homelab proxy on another machine.
Use 127.0.0.1 if the reverse proxy is local. The launcher always allows
`https://voxpilot.apps.lasath.com`, `https://voxpilot.staging.lasath.com`, and
`https://voxpilot.lasath.com`, plus `https://opencode-dev2.apps.lasath.com`.
`VOXPILOT_ORIGIN` adds one more exact browser origin and must not have a trailing
slash. OpenCode owns authentication, including pairing; the launcher does not
supply a default password.

```sh
mkdir -p ~/.config/systemd/user
ln -sfn ~/.local/share/voxpilot/systemd/voxpilot.service ~/.config/systemd/user/voxpilot.service
systemctl --user daemon-reload
systemctl --user enable --now voxpilot.service
```

On upgrade, stop the service, extract the new archive, then daemon-reload and
restart. The existing dev-setup `install-voxpilot.sh` already does this. No global
OpenCode plugin installation is needed. The launcher only applies its plugin to
this OpenCode process, using OpenCode's inline config environment variable.

The unit reads the user manager's PATH. If opencode is installed in a user-specific
bin directory, expose it through `~/.config/environment.d` as with other user services.

### Upgrade from the sidecar release

Port 8000 now serves OpenCode directly; `/oc` and the old `/api/review` and
`/api/config` routes are gone. Set `OPENCODE_PASSWORD` instead of
`VOXPILOT_OC_PASSWORD`. There is no separate `VOXPILOT_OC_PORT`.

Stale binaries, databases, and migration directories left by an in-place
extraction are unused. Review references created by the retired backend are not
imported into plugin storage.

## Central Caddy frontend

Extract `voxpilot-frontend-<version>.tar.gz` into the static site's document root.
Alternatively, serve the `static/` directory from the host tarball. The build output
contains no server-specific URLs or credentials.

Example Caddy configuration (adjust paths and hostnames):

```caddyfile
voxpilot.apps.example.com {
    root * /srv/voxpilot
    # Apply your network restriction / reverse-proxy auth to the ENTIRE site,
    # including config.json. Do not expose this endpoint anonymously.
    handle /config.json {
        header Cache-Control "no-store"
        file_server
    }
    handle {
        @fresh path /index.html /manifest.webmanifest
        header @fresh Cache-Control "no-cache"
        try_files {path} /index.html
        file_server
    }
}

opencode-dev2.apps.example.com {
    reverse_proxy dev2:8000 {
        flush_interval -1
    }
}
```

### Shared server configuration

Copy `packaging/config.example.json` to `/srv/voxpilot/config.json` and fill in
the deployment's server URLs and passwords. The file is deployment-owned: keep it
outside source control and preserve it when upgrading frontend assets. Every server
needs a unique, stable `id`, a display `name`, an HTTP(S) `url` without embedded
credentials/query/fragment, and a `password` (an empty string uses same-origin cookies).

VoxPilot fetches `config.json` at startup with `cache: no-store`. New devices choose
a named server and Connect; no credential entry is needed. Only the selected ID is
saved in localStorage. Configured credentials stay in memory and are refetched on
reload, so password changes take effect without clearing browser storage. Removed
IDs return to the picker. An invalid, empty, or inaccessible configuration blocks
connections with a configuration error (without input values or response bodies);
a true 404 enables the legacy manual form.

**Anyone who can access config.json can read and copy every backend password.**
This is a trusted-user deployment, not server-side secret storage. Protect the
entire site with trusted-network restrictions or reverse-proxy authentication,
serve it over HTTPS, and keep backend authentication enabled. Do not add CORS
access to the config endpoint. The dedicated Caddy handler above prevents a missing
config from becoming the SPA HTML fallback and disables caching.

For local development, put the same JSON in `frontend/config.local.json` (ignored
by Git). Vite serves it with `no-store` but never copies it into production assets.
Builds refuse `frontend/public/config.json` to prevent accidental secret packaging.
Do not put the real file in public or dist before creating release archives.

Without a config file, enter a server URL and password manually. The password
stays in the tab's sessionStorage. Leave it blank only for a paired same-origin
deployment. Cross-origin connections use Basic auth because OpenCode's CORS does
not enable credentialed cookie requests.
API hosts must use HTTPS when the frontend does.

Settings in the bottom bar change hosts. Saved wake URLs are scoped by API host.
The frontend has a static manifest for home-screen installation and renders
width-aware reviews on resize. It does not register a service worker or cache
frontend assets/API responses in Cache Storage.

## Uninstall

Disable `voxpilot.service` and remove its symlink and installed release directory.
No plugin was added to global OpenCode config. Snapshot storage belongs to OpenCode;
removing the release does not delete sessions or plugin data.
