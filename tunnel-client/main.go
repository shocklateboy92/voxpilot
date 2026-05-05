// Package main implements voxpilot-tunnel, the host-side sidecar that
// joins a backend to a remote VoxPilot gateway.
//
// The sidecar opens a single outbound WebSocket to the gateway, wraps it
// as a yamux client session, and:
//
//   - Sends a one-shot "hello" message on a control stream, identifying
//     this host (name, version, optional WoL webhook URL).
//   - Sends periodic heartbeats on the same control stream so the gateway
//     can show fresh "last seen" times in its picker.
//   - Accepts incoming yamux streams from the gateway, treats each as a
//     single inbound HTTP request, forwards it to the local VoxPilot
//     backend on http://127.0.0.1:8000 (configurable), and streams the
//     response back.
//
// The local backend is unaware of the gateway; from its perspective it
// receives ordinary loopback HTTP requests.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Build-time injected version. Reported to the gateway in the hello message
// so the picker UI can warn about frontend/backend skew.
var version = "0.0.0-dev"

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

func main() {
	gatewayURL := os.Getenv("VOXPILOT_GATEWAY_URL")
	if gatewayURL == "" {
		log.Fatal("VOXPILOT_GATEWAY_URL must be set (e.g. wss://voxpilot.example.com/api/gateway/tunnel)")
	}
	token := os.Getenv("VOXPILOT_GATEWAY_TOKEN")
	if token == "" {
		log.Fatal("VOXPILOT_GATEWAY_TOKEN must be set (shared secret with the gateway)")
	}
	localURL := envOr("VOXPILOT_LOCAL_URL", "http://127.0.0.1:8000")
	wakeURL := os.Getenv("VOXPILOT_WAKE_URL")
	name := envOr("VOXPILOT_INSTANCE_NAME", hostnameOr("voxpilot"))
	if v := envOr("VOXPILOT_VERSION", ""); v != "" {
		version = v
	}

	cfg := clientConfig{
		gatewayURL: gatewayURL,
		token:      token,
		localURL:   localURL,
		wakeURL:    wakeURL,
		name:       name,
		version:    version,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Printf("voxpilot-tunnel %s: name=%s gateway=%s local=%s", version, name, gatewayURL, localURL)
	runWithBackoff(ctx, cfg)
	log.Printf("stopped.")
}

// runWithBackoff dials the gateway and runs one session at a time. On any
// disconnect it waits with exponential backoff (capped) and reconnects,
// until the context is cancelled.
func runWithBackoff(ctx context.Context, cfg clientConfig) {
	const (
		minDelay = 1 * time.Second
		maxDelay = 30 * time.Second
	)
	delay := minDelay
	for {
		if ctx.Err() != nil {
			return
		}
		started := time.Now()
		err := runOnce(ctx, cfg)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			log.Printf("tunnel: session ended: %v", err)
		} else {
			log.Printf("tunnel: session ended cleanly")
		}
		// If the session lasted long enough that the connection was
		// healthy, reset backoff. Otherwise grow it.
		if time.Since(started) > 30*time.Second {
			delay = minDelay
		} else {
			delay *= 2
			if delay > maxDelay {
				delay = maxDelay
			}
		}
		log.Printf("tunnel: reconnecting in %s", delay)
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}

func hostnameOr(fallback string) string {
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return fallback
}
