package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
)

// Wire format on the control stream. Must match gateway/tunnel.go exactly.

type helloMsg struct {
	Proto   int    `json:"proto"`
	Name    string `json:"name"`
	Version string `json:"version"`
	WakeURL string `json:"wake_url,omitempty"`
}

type heartbeatMsg struct {
	Type string `json:"type"`
}

const (
	protocolVersion   = 1
	heartbeatInterval = 30 * time.Second
)

type clientConfig struct {
	gatewayURL string
	token      string
	localURL   string
	wakeURL    string
	name       string
	version    string
}

// runOnce dials the gateway, registers, and serves until either the context
// is cancelled or the session disconnects. Returns nil on clean shutdown,
// otherwise the underlying error.
func runOnce(ctx context.Context, cfg clientConfig) error {
	// Validate the local URL early so the failure is obvious.
	if _, err := url.Parse(cfg.localURL); err != nil {
		return fmt.Errorf("invalid VOXPILOT_LOCAL_URL %q: %w", cfg.localURL, err)
	}

	dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	ws, _, err := websocket.Dial(dialCtx, cfg.gatewayURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + cfg.token}},
	})
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	// Disable read limit -- HTTP request bodies through the tunnel can
	// be arbitrarily large.
	ws.SetReadLimit(-1)

	wsConn := websocket.NetConn(ctx, ws, websocket.MessageBinary)
	defer wsConn.Close()

	// Tunnel client is the yamux client side. It opens streams for control
	// (and may open more in the future); the server (gateway) opens streams
	// to forward inbound HTTP requests to us.
	ycfg := yamux.DefaultConfig()
	ycfg.LogOutput = io.Discard
	sess, err := yamux.Client(wsConn, ycfg)
	if err != nil {
		return fmt.Errorf("yamux client: %w", err)
	}
	defer sess.Close()

	// Open the control stream and send hello.
	control, err := sess.Open()
	if err != nil {
		return fmt.Errorf("open control stream: %w", err)
	}
	defer control.Close()

	enc := json.NewEncoder(control)
	if err := enc.Encode(helloMsg{
		Proto:   protocolVersion,
		Name:    cfg.name,
		Version: cfg.version,
		WakeURL: cfg.wakeURL,
	}); err != nil {
		return fmt.Errorf("send hello: %w", err)
	}
	log.Printf("tunnel: connected, registered as %q", cfg.name)

	forwarder := newForwarder(cfg.localURL)

	// Three loops: heartbeats out, accept inbound streams (HTTP requests),
	// and watch for context cancellation. Whichever exits first triggers
	// the rest via the shared err channel.
	errCh := make(chan error, 3)
	var once sync.Once
	finish := func(e error) { once.Do(func() { errCh <- e }) }

	go func() {
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				finish(nil)
				return
			case <-sess.CloseChan():
				finish(errors.New("session closed"))
				return
			case <-ticker.C:
				if err := enc.Encode(heartbeatMsg{Type: "heartbeat"}); err != nil {
					finish(fmt.Errorf("heartbeat: %w", err))
					return
				}
			}
		}
	}()

	go func() {
		for {
			stream, err := sess.AcceptStream()
			if err != nil {
				finish(fmt.Errorf("accept stream: %w", err))
				return
			}
			go forwarder.serve(stream)
		}
	}()

	go func() {
		<-ctx.Done()
		finish(nil)
	}()

	err = <-errCh
	return err
}
