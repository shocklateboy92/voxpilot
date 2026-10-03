# VoxPilot

Self-hosted, web-based AI coding assistant. See https://github.com/shocklateboy92/voxpilot.

## Install (Linux, systemd user services)

This tarball contains everything needed to run VoxPilot as a `systemctl --user`
service. Extract to `~/.local/share/`, symlink the unit file, enable.

### Prerequisites

- Linux with systemd (any modern distro)
- Native [OpenCode 2.x](https://opencode.ai/v2/docs/) (`@opencode/cli`, tested
  with 2.0.22) on `PATH`. The old
  `opencode-ai` 1.x package is incompatible.
- An OpenAI-compatible LLM endpoint reachable from this machine (configured
  via OpenCode's own config -- see https://opencode.ai/v2/docs/providers/)

> **PATH note:** systemd `--user` services don't source `~/.bashrc` /
> `~/.zshrc`, so they only see the user manager's `PATH` (typically
> `/usr/local/bin:/usr/bin:/bin` plus whatever `pam_env`/`environment.d`
> adds). If `opencode` (or any other CLI VoxPilot calls) lives in
> `~/.bun/bin`, `~/.npm-global/bin`, an asdf/mise shim dir, etc., add that
> directory to `~/.config/environment.d/10-voxpilot.conf`:
>
> ```ini
> PATH=$HOME/.bun/bin:$HOME/.local/bin:${PATH}
> ```
>
> Then `systemctl --user daemon-reexec` (or log out and back in) so the
> user manager re-reads it. See `environment.d(5)`.

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
systemctl --user disable --now voxpilot.service
rm ~/.config/systemd/user/voxpilot.service
rm -rf ~/.local/share/voxpilot
```

## Files

```
voxpilot/
├── voxpilot              VoxPilot binary (Bun --compile)
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
| `VOXPILOT_OC_PORT` | auto-pick | Embedded OpenCode server port (0 = OS picks a free one) |
| `VOXPILOT_OC_PASSWORD` | `abc123` | Password for direct OpenCode access (username `opencode`) |
| `VOXPILOT_DB_PATH` | `voxpilot.db` (relative to WorkingDirectory) | SQLite path |
| `VOXPILOT_WAKE_URL` | (unset) | Optional Home Assistant webhook for Wake-on-LAN |

VoxPilot starts and stops only its own OpenCode process, bound to all interfaces.
It does not stop or replace the shared OpenCode service. OpenCode V2 requires a
server password. Direct LAN clients use username `opencode` and the configured
`VOXPILOT_OC_PASSWORD`; VoxPilot injects it for the passwordless `/oc` proxy.
These endpoints need your existing trusted-network or reverse-proxy controls.
