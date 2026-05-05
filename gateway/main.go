// Package main implements the VoxPilot gateway.
//
// The gateway is the single internet-facing component of a multi-host
// VoxPilot deployment. Browsers reach it over HTTPS (terminated by Caddy
// upstream), backend hosts reach it via outbound WebSocket tunnels, and
// the gateway brokers HTTP requests between the two.
//
// Routing surface:
//
//	GET  /api/gateway/tunnel              -- WebSocket; tunnel clients connect here
//	GET  /api/gateway/instances           -- JSON list of registered backends
//	POST /api/gateway/wake/{name}         -- (Phase 3) WoL passthrough to per-host webhook
//	*    /backends/{name}/...             -- proxied to that backend over its tunnel
//	*    /...                             -- (Phase 2) frontend static assets
//
// In Phase 1 the static frontend is not yet embedded; unknown paths return 404.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

func main() {
	bind := envOr("VPGW_BIND", ":8080")
	tunnelToken := os.Getenv("VPGW_TUNNEL_TOKEN")
	if tunnelToken == "" {
		log.Fatal("VPGW_TUNNEL_TOKEN must be set (shared secret presented by tunnel clients)")
	}

	heartbeatTimeout := 60 * time.Second
	if v := os.Getenv("VPGW_HEARTBEAT_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			log.Fatalf("invalid VPGW_HEARTBEAT_TIMEOUT %q: %v", v, err)
		}
		heartbeatTimeout = d
	}

	registry := newRegistry(heartbeatTimeout)

	mux := http.NewServeMux()
	mux.Handle("GET /api/gateway/tunnel", &tunnelHandler{
		registry: registry,
		token:    tunnelToken,
	})
	mux.HandleFunc("GET /api/gateway/instances", func(w http.ResponseWriter, r *http.Request) {
		writeInstances(w, registry)
	})

	// Frontend: embedded SolidJS bundle, with SPA fallback to index.html
	// for any path that doesn't match an asset. The bundle handles both
	// the picker (rendered when path = "/") and the chat app (rendered
	// for /backends/<name>/...).
	staticH, err := newStaticHandler()
	if err != nil {
		log.Fatalf("frontend: %v", err)
	}

	// /backends/{name}/(api|oc|mcp)/... -> proxy to the backend.
	// /backends/{name}/<anything else>  -> serve the SPA (with prefix
	// stripped so asset URLs resolve correctly).
	mux.Handle("/backends/", &proxyHandler{registry: registry, next: staticH})

	// Root: picker page (and any client-side route under "/" that the
	// SPA might add later).
	mux.Handle("/", staticH)

	srv := &http.Server{
		Addr:    bind,
		Handler: mux,
		// SSE and tunneled requests are long-lived; don't impose write
		// deadlines that would chop them off. Read header timeout protects
		// against slowloris on initial request lines.
		ReadHeaderTimeout: 30 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		log.Printf("shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("server shutdown: %v", err)
		}
		registry.closeAll()
	}()

	log.Printf("voxpilot-gateway listening on %s", bind)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("listen: %v", err)
	}
	log.Printf("stopped.")
}
