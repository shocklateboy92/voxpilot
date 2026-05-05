# voxpilot-gateway

The gateway is the single internet-facing component of a multi-host VoxPilot
deployment. Browsers reach it over HTTPS (terminated by Caddy upstream),
backend hosts reach it via outbound WebSocket tunnels, and the gateway
brokers HTTP requests between the two.

The gateway also serves the VoxPilot frontend (embedded via `embed.FS`):
the picker page at `/`, and the chat app at `/backends/<name>/...`.

## Routing

| Path                                       | Handled by                              |
| ------------------------------------------ | --------------------------------------- |
| `GET  /api/gateway/tunnel`                 | WebSocket; tunnel clients connect       |
| `GET  /api/gateway/instances`              | JSON list of registered backends        |
| `*    /backends/{name}/(api\|oc\|mcp)/...` | Proxied to that backend's tunnel        |
| `*    /backends/{name}/...` (other paths)  | SPA fallback to embedded `index.html`   |
| `*    /assets/*`, `/icon-*.png`, etc.      | Embedded frontend assets                |
| `*    /`                                   | Embedded frontend (renders the picker)  |

Path stripping for tunneled paths: a request for
`/backends/devbox/api/health` arrives at the backend as `/api/health`.
The original `Host` header is preserved.

The frontend bundle uses `window.location.pathname` at module load to
detect its prefix (see `frontend/src/backend-base.ts`):

- `/` -> picker mode (lists registered backends)
- `/backends/<name>/...` -> SPA boots, all `/api` and `/oc` calls go to
  `/backends/<name>/api/...` and `/backends/<name>/oc/...`
- Anything else -> standalone mode (Vite dev), API calls go to root

## Configuration

| Env var                     | Default | Notes                                           |
| --------------------------- | ------- | ----------------------------------------------- |
| `VPGW_BIND`                 | `:8080` | HTTP listen address                             |
| `VPGW_TUNNEL_TOKEN`         | _none_  | **Required.** Shared secret for tunnels.        |
| `VPGW_HEARTBEAT_TIMEOUT`    | `60s`   | Mark instance offline after this gap            |
| `VPGW_FRONTEND_DIR`         | _empty_ | Override the embedded frontend (point at `frontend/dist`) |

## Tunnel protocol

Tunnel clients connect with `Authorization: Bearer <token>` to upgrade the
WebSocket. The connection is wrapped as a `yamux` session; the client opens
a control stream and sends a JSON-line `helloMsg`:

```json
{"proto": 1, "name": "devbox", "version": "0.1.42+abc1234", "wake_url": "..."}
```

Heartbeats (`{"type": "heartbeat"}`) flow on the same control stream every
~30s. The gateway opens a fresh yamux stream for every inbound HTTP request
and uses `httputil.ReverseProxy` over it, with `FlushInterval: -1` to keep
SSE responses unbuffered.

## Build

The gateway expects the frontend bundle at `gateway/static/`. Build the
frontend first:

```sh
( cd frontend && npm run build && cp -r dist/* ../gateway/static/ )
go build -o voxpilot-gateway ./gateway/...
```

The release pipeline (Phase 4) will wire this together via Docker.

## Local smoke test

```sh
# Terminal 1: real VoxPilot backend
( cd backend && VOXPILOT_PORT=18000 bun run src/index.ts )

# Terminal 2: gateway with frontend embedded
VPGW_BIND=:18080 VPGW_TUNNEL_TOKEN=dev ./voxpilot-gateway

# Terminal 3: tunnel client
VOXPILOT_GATEWAY_URL=ws://127.0.0.1:18080/api/gateway/tunnel \
  VOXPILOT_GATEWAY_TOKEN=dev \
  VOXPILOT_INSTANCE_NAME=devbox \
  VOXPILOT_LOCAL_URL=http://127.0.0.1:18000 \
  ./voxpilot-tunnel

# Browser:
#   http://localhost:18080/                  -> picker
#   http://localhost:18080/backends/devbox/  -> chat app
```

## Known limitations

- No persistent state. Gateway restart loses all registrations until clients
  reconnect (a few seconds with default backoff).
- No WebSocket proxying through the tunnel. SSE works; raw WS upgrades do
  not. VoxPilot does not currently use WS upstream of the tunnel.
- No WoL endpoint. Lands in Phase 3.
- Frontend/backend version skew not yet detected/warned. Lands in Phase 3.
