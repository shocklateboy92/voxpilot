# VoxPilot

Self-hosted, web-based AI coding assistant. See https://github.com/shocklateboy92/voxpilot.

## Install (Linux, systemd user services)

This tarball contains everything needed to run VoxPilot as a `systemctl --user`
service. Extract to `~/.local/share/`, symlink the unit file, enable.

### Prerequisites

- Linux with systemd (any modern distro)
- [opencode](https://opencode.ai) on `PATH` (`pacman -S opencode`,
  `brew install anomalyco/tap/opencode`, or
  `curl -fsSL https://opencode.ai/install | bash`)
- An OpenAI-compatible LLM endpoint reachable from this machine (configured
  via `opencode`'s own config -- see https://opencode.ai/docs/providers)

### One-time setup

```sh
# 1. Extract this tarball
mkdir -p ~/.local/share
tar -xzf voxpilot-*-linux-x64.tar.gz -C ~/.local/share

# 2. Install the systemd unit
mkdir -p ~/.config/systemd/user
ln -sfn ~/.local/share/voxpilot/systemd/voxpilot.service \
        ~/.config/systemd/user/voxpilot.service

# 3. Reload + enable
systemctl --user daemon-reload
systemctl --user enable --now voxpilot.service
```

VoxPilot is now serving on http://localhost:8000.

To make it survive logout / start at boot:

```sh
sudo loginctl enable-linger "$USER"
```

### Optional: Tailscale exposure (tsnet-proxy)

```sh
mkdir -p ~/.config/voxpilot
cat > ~/.config/voxpilot/tsnet.env <<EOF
TS_HOSTNAME=voxpilot
TS_AUTHKEY=tskey-auth-...    # from https://login.tailscale.com/admin/settings/keys
EOF
chmod 600 ~/.config/voxpilot/tsnet.env

ln -sfn ~/.local/share/voxpilot/systemd/voxpilot-tsnet.service \
        ~/.config/systemd/user/voxpilot-tsnet.service
systemctl --user daemon-reload
systemctl --user enable --now voxpilot-tsnet.service
```

## Update

Re-extract the tarball over the existing install, then restart:

```sh
tar -xzf voxpilot-*-linux-x64.tar.gz -C ~/.local/share
systemctl --user daemon-reload
systemctl --user restart voxpilot.service
```

The systemd unit is symlinked into the install tree, so it auto-updates with
the rest of the files.

## Uninstall

```sh
systemctl --user disable --now voxpilot.service voxpilot-tsnet.service
rm ~/.config/systemd/user/voxpilot{,-tsnet}.service
rm -rf ~/.local/share/voxpilot
# Optionally:
rm -rf ~/.config/voxpilot ~/.local/state/voxpilot-tsnet
```

## Files

```
voxpilot/
├── voxpilot              VoxPilot binary (Bun --compile)
├── tsnet-proxy           Tailscale proxy binary (Go, optional)
├── drizzle/              SQLite migrations (auto-applied at startup)
├── static/               Built frontend assets
├── systemd/              systemd --user unit files
├── VERSION               This release's version string
└── README.md             This file
```

## Configuration

Environment variables (set in the unit's `EnvironmentFile=` or `Environment=`):

| Variable | Default | Purpose |
|---|---|---|
| `VOXPILOT_PORT` | `8000` | HTTP server port |
| `VOXPILOT_OC_PORT` | `4097` | Embedded OpenCode server port |
| `VOXPILOT_DB_PATH` | `voxpilot.db` (relative to WorkingDirectory) | SQLite path |
| `VOXPILOT_WAKE_URL` | (unset) | Optional Home Assistant webhook for Wake-on-LAN |

For the tsnet proxy, see `~/.config/voxpilot/tsnet.env` (see Tailscale section above).
