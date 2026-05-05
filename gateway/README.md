# voxpilot-gateway

The gateway is the single internet-facing component of a multi-host VoxPilot
deployment. Browsers reach it over HTTPS (terminated by Caddy upstream),
backend hosts reach it via outbound WebSocket tunnels, and the gateway
brokers HTTP requests between the two.

In Phase 1 (this PR), the gateway is a thin proxy + tunnel server. The
frontend is not yet embedded; the picker UI and WoL endpoints land in
later phases.

## Routing

| Path                              | Handled by                         |
| --------------------------------- | ---------------------------------- |
| `GET  /api/gateway/tunnel`        | WebSocket; tunnel clients connect  |
| `GET  /api/gateway/instances`     | JSON list of registered backends   |
| `*    /backends/{name}/...`       | Proxied to that backend's tunnel   |
| `*    /...`                       | 404 (Phase 2: frontend assets)     |

Path stripping: a request for `/backends/devbox/api/health` arrives at the
backend as `/api/health`. The original `Host` header is preserved.

## Configuration

| Env var                     | Default | Notes                                      |
| --------------------------- | ------- | ------------------------------------------ |
| `VPGW_BIND`                 | `:8080` | HTTP listen address                        |
| `VPGW_TUNNEL_TOKEN`         | _none_  | **Required.** Shared secret for tunnels.   |
| `VPGW_HEARTBEAT_TIMEOUT`    | `60s`   | Mark instance offline after this gap       |

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

```sh
go build -o voxpilot-gateway ./...
```

A Dockerfile lives alongside this README (Phase 4 will wire it into the
release pipeline).

## Local smoke test

```sh
# Terminal 1: gateway
VPGW_BIND=:18080 VPGW_TUNNEL_TOKEN=dev ./voxpilot-gateway

# Terminal 2: a fake local backend
python3 -m http.server 18000

# Terminal 3: tunnel client (from ../tunnel-client)
VOXPILOT_GATEWAY_URL=ws://127.0.0.1:18080/api/gateway/tunnel \
  VOXPILOT_GATEWAY_TOKEN=dev \
  VOXPILOT_INSTANCE_NAME=smoke \
  VOXPILOT_LOCAL_URL=http://127.0.0.1:18000 \
  ./voxpilot-tunnel

# Terminal 4: hit the gateway
curl http://127.0.0.1:18080/api/gateway/instances
curl http://127.0.0.1:18080/backends/smoke/
```

## Known limitations (Phase 1)

- No persistent state. Gateway restart loses all registrations until clients
  reconnect (a few seconds with default backoff).
- No WebSocket proxying through the tunnel. SSE works; raw WS upgrades do
  not. VoxPilot does not currently use WS upstream of the tunnel.
- No frontend serving. Picker UI lands in Phase 2.
- No WoL endpoint. Lands in Phase 3.
