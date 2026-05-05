# VoxPilot

Self-hosted, web-based AI coding assistant. See https://github.com/shocklateboy92/voxpilot.

VoxPilot is split into two pieces:

- **Backend host** (this tarball): the `voxpilot` API server + an optional
  `voxpilot-tunnel` sidecar. Runs on every machine you want to drive
  through VoxPilot.
- **Gateway** (separate Docker image): the single TLS-fronted entrypoint.
  Serves the frontend, proxies traffic to backends over their tunnels,
  hosts the picker UI, and forwards Wake-on-LAN webhooks.

This README covers the backend host. For the gateway see the project
repo (`gateway/`) and the published image at
`ghcr.io/<owner>/voxpilot-gateway`.

## Install (Linux, systemd user services)

This tarball runs VoxPilot as a `systemctl --user` service. Extract to
`~/.local/share/`, symlink the unit file, enable.

### Prerequisites

- Linux with systemd (any modern distro)
- [opencode](https://opencode.ai) on `PATH` (`pacman -S opencode`,
  `brew install anomalyco/tap/opencode`, or
  `curl -fsSL https://opencode.ai/install | bash`)
- An OpenAI-compatible LLM endpoint reachable from this machine
  (configured via `opencode`'s own config; see
  https://opencode.ai/docs/providers)

### One-time setup

```sh
# 1. Extract this tarball
mkdir -p ~/.local/share
tar -xzf voxpilot-*-linux-x64.tar.gz -C ~/.local/share

# 2. Install the backend systemd unit
mkdir -p ~/.config/systemd/user
ln -sfn ~/.local/share/voxpilot/systemd/voxpilot.service \
        ~/.config/systemd/user/voxpilot.service

# 3. Reload + enable
systemctl --user daemon-reload
systemctl --user enable --now voxpilot.service
```

VoxPilot is now serving on http://localhost:8000. Browser access from
this machine works directly; for any other access path, set up the
gateway tunnel below.

To make it survive logout / start at boot:

```sh
sudo loginctl enable-linger "$USER"
```

### Connecting to a gateway (recommended)

To make this backend reachable from your gateway (and therefore from any
browser that can reach the gateway, with no inbound port required on
this host), enable the `voxpilot-tunnel` sidecar:

```sh
mkdir -p ~/.config/voxpilot
cat > ~/.config/voxpilot/tunnel.env <<EOF
VOXPILOT_GATEWAY_URL=wss://voxpilot.example.com/api/gateway/tunnel
VOXPILOT_GATEWAY_TOKEN=<shared secret>
# Optional:
# VOXPILOT_INSTANCE_NAME=devbox
# VOXPILOT_LOCAL_URL=http://127.0.0.1:8000
# VOXPILOT_WAKE_URL=https://homeassistant/api/webhook/<id>
EOF
chmod 600 ~/.config/voxpilot/tunnel.env

ln -sfn ~/.local/share/voxpilot/systemd/voxpilot-tunnel.service \
        ~/.config/systemd/user/voxpilot-tunnel.service
systemctl --user daemon-reload
systemctl --user enable --now voxpilot-tunnel.service
```

The sidecar dials the gateway over outbound HTTPS only; no firewall
rules are needed on this host. The `VOXPILOT_GATEWAY_TOKEN` is the
shared secret you also configured on the gateway as
`VPGW_TUNNEL_TOKEN`.

After enabling, the host appears in the gateway picker at
`/backends/<instance-name>/`. If you set `VOXPILOT_WAKE_URL`, the
picker shows a "wake" button when this host is offline; the gateway
POSTs to that URL (typically a Home Assistant webhook that broadcasts
a Wake-on-LAN packet).

## Update

Re-extract the tarball over the existing install, then restart:

```sh
tar -xzf voxpilot-*-linux-x64.tar.gz -C ~/.local/share
systemctl --user daemon-reload
systemctl --user restart voxpilot.service voxpilot-tunnel.service
```

The systemd units are symlinked into the install tree, so they
auto-update with the rest of the files.

## Uninstall

```sh
systemctl --user disable --now voxpilot.service voxpilot-tunnel.service
rm ~/.config/systemd/user/voxpilot{,-tunnel}.service
rm -rf ~/.local/share/voxpilot
# Optionally:
rm -rf ~/.config/voxpilot
```

## Files

```
voxpilot/
├── voxpilot              VoxPilot backend binary (Bun --compile)
├── voxpilot-tunnel       Gateway tunnel sidecar (Go, optional)
├── drizzle/              SQLite migrations (auto-applied at startup)
├── systemd/              systemd --user unit files
├── VERSION               This release's version string
└── README.md             This file
```

The frontend bundle is **not** in this tarball -- it lives in the
gateway Docker image, served on demand by the gateway alongside the
picker. Backends are headless API servers.

## Configuration

Backend (`voxpilot.service`) environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `VOXPILOT_PORT` | `8000` | HTTP server port (loopback if behind a tunnel) |
| `VOXPILOT_OC_PORT` | auto-pick | Embedded OpenCode server port |
| `VOXPILOT_DB_PATH` | `voxpilot.db` (relative to `WorkingDirectory`) | SQLite path |

Tunnel (`voxpilot-tunnel.service`, set in
`~/.config/voxpilot/tunnel.env`):

| Variable | Default | Purpose |
|---|---|---|
| `VOXPILOT_GATEWAY_URL` | _required_ | `wss://gateway/api/gateway/tunnel` |
| `VOXPILOT_GATEWAY_TOKEN` | _required_ | Shared secret with the gateway |
| `VOXPILOT_INSTANCE_NAME` | hostname | URL slug at `/backends/<name>/` |
| `VOXPILOT_LOCAL_URL` | `http://127.0.0.1:8000` | Where the backend listens |
| `VOXPILOT_WAKE_URL` | (unset) | Optional wake-on-LAN webhook |
