package main

import (
	"context"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"tailscale.com/tsnet"
)

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

func main() {
	hostname := envOr("TS_HOSTNAME", "voxpilot")
	authKey := os.Getenv("TS_AUTHKEY")
	ephemeralStr := envOr("TS_EPHEMERAL", "false")
	stateDir := os.Getenv("TS_STATE_DIR")
	proxyTarget := envOr("PROXY_TARGET", "http://127.0.0.1:3000")

	ephemeral, err := strconv.ParseBool(ephemeralStr)
	if err != nil {
		log.Fatalf("invalid TS_EPHEMERAL value %q: %v", ephemeralStr, err)
	}

	targetURL, err := url.Parse(proxyTarget)
	if err != nil {
		log.Fatalf("invalid PROXY_TARGET %q: %v", proxyTarget, err)
	}

	srv := &tsnet.Server{
		Hostname:  hostname,
		AuthKey:   authKey,
		Ephemeral: ephemeral,
	}
	if stateDir != "" {
		srv.Dir = stateDir
	}

	log.Printf("Starting tsnet node %q, proxying to %s", hostname, proxyTarget)

	ln, err := srv.ListenTLS("tcp", ":443")
	if err != nil {
		log.Fatalf("ListenTLS failed: %v", err)
	}

	if domains := srv.CertDomains(); len(domains) > 0 {
		log.Printf("Listening on https://%s", strings.Join(domains, ", https://"))
	}

	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(targetURL)
			r.SetXForwarded()
			// Preserve the original Host header for WebSocket upgrade checks
			// and for backends that care about the Host.
			r.Out.Host = r.In.Host
		},
		FlushInterval: -1, // flush immediately for SSE / streaming
		ErrorLog:      log.New(os.Stderr, "proxy: ", log.LstdFlags),
	}

	httpServer := &http.Server{
		Handler: proxy,
	}

	// Graceful shutdown on SIGINT / SIGTERM.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		log.Printf("Shutting down...")
		if err := httpServer.Close(); err != nil {
			log.Printf("HTTP server close error: %v", err)
		}
		if err := ln.Close(); err != nil {
			log.Printf("Listener close error: %v", err)
		}
		if err := srv.Close(); err != nil {
			log.Printf("tsnet server close error: %v", err)
		}
	}()

	if err := httpServer.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Serve failed: %v", err)
	}

	log.Printf("Stopped.")
}
