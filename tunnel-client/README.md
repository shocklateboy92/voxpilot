# voxpilot-tunnel

The host-side sidecar that joins a backend to a remote VoxPilot gateway.

Each VoxPilot host runs three things:

1. `voxpilot` -- the Bun backend, listening on `127.0.0.1:8000` (loopback
   only, completely unaware of the gateway)
2. `voxpilot-tunnel` -- this binary, which dials the gateway and forwards
   inbound requests to the backend
3. `opencode` -- on `PATH`, spawned by the backend

The sidecar opens a single outbound WebSocket to the gateway, wraps it as
a `yamux` client session, and:

- Sends a one-shot `hello` message identifying this host (name, version,
  optional WoL webhook URL)
- Sends periodic heartbeats so the gateway can show fresh "last seen"
  times in its picker UI
- Accepts incoming yamux streams from the gateway, treats each as a
  single inbound HTTP request, forwards it to the local backend, and
  streams the response back

## Configuration

| Env var                     | Default              | Notes                              |
| --------------------------- | -------------------- | ---------------------------------- |
| `VOXPILOT_GATEWAY_URL`      | _none_               | **Required.** `wss://...`          |
| `VOXPILOT_GATEWAY_TOKEN`    | _none_               | **Required.** Shared with gateway. |
| `VOXPILOT_LOCAL_URL`        | `http://127.0.0.1:8000` | Where the backend listens       |
| `VOXPILOT_INSTANCE_NAME`    | `os.Hostname()`      | Becomes `/backends/<name>/...`     |
| `VOXPILOT_WAKE_URL`         | _empty_              | Optional HA webhook (Phase 3)      |
| `VOXPILOT_VERSION`          | `0.0.0-dev`          | Build-time injected normally       |

## Reconnection

On any disconnect, the client waits with exponential backoff (1s -> 30s,
capped) and reconnects. Sessions that lasted >30s are treated as healthy
and reset the backoff to 1s.

## Build

```sh
go build -o voxpilot-tunnel ./...
```
