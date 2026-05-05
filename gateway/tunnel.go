package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
)

// Wire format on the control stream. JSON-line framed: each message is a
// single JSON object terminated by '\n'. Backwards-incompatible changes
// must bump the protocol version (see helloMsg.Proto).

type helloMsg struct {
	Proto   int    `json:"proto"`
	Name    string `json:"name"`
	Version string `json:"version"`
	WakeURL string `json:"wake_url,omitempty"`
}

type heartbeatMsg struct {
	Type string `json:"type"` // "heartbeat"
}

const protocolVersion = 1

type tunnelHandler struct {
	registry *registry
	token    string
}

func (h *tunnelHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Bearer-token auth on the WS upgrade. We use a simple shared secret;
	// when the gateway is exposed publicly this is all that prevents
	// arbitrary clients from registering as a backend.
	auth := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(auth) <= len(prefix) || auth[:len(prefix)] != prefix || auth[len(prefix):] != h.token {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Tunnel clients connect from arbitrary origins (any backend host
		// running tunnel-client). The token is the security boundary, not
		// the Origin header.
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Printf("tunnel: ws accept failed: %v", err)
		return
	}

	// Tunnels stay open indefinitely; let the underlying request context
	// die only when the connection closes. websocket.NetConn handles
	// CloseRead -- needed so reads in the yamux session can detect
	// client-side closes promptly.
	ctx := r.Context()
	wsConn := websocket.NetConn(ctx, ws, websocket.MessageBinary)

	// Gateway is the yamux server: clients (tunnel-clients) initiate
	// streams for control, and the gateway initiates streams when
	// proxying HTTP requests inbound.
	cfg := yamux.DefaultConfig()
	cfg.LogOutput = io.Discard // yamux is chatty; route logs through our own logger
	sess, err := yamux.Server(wsConn, cfg)
	if err != nil {
		log.Printf("tunnel: yamux server: %v", err)
		_ = ws.Close(websocket.StatusInternalError, "yamux init failed")
		return
	}
	defer sess.Close()

	// Wait for the client's control stream and hello message.
	// Anything that takes more than 10s is suspicious; reject it.
	acceptCtx, cancel := contextWithTimeout(ctx, 10*time.Second)
	defer cancel()
	control, err := sess.AcceptStreamWithContext(acceptCtx)
	if err != nil {
		log.Printf("tunnel: accept control stream: %v", err)
		return
	}

	dec := json.NewDecoder(control)
	var hello helloMsg
	if err := dec.Decode(&hello); err != nil {
		log.Printf("tunnel: read hello: %v", err)
		return
	}
	if hello.Proto != protocolVersion {
		log.Printf("tunnel: protocol version mismatch: client=%d server=%d", hello.Proto, protocolVersion)
		return
	}
	if hello.Name == "" {
		log.Printf("tunnel: hello missing name")
		return
	}

	inst := &instance{
		name:        hello.Name,
		version:     hello.Version,
		wakeURL:     hello.WakeURL,
		session:     sess,
		transport:   newYamuxTransport(sess),
		connectedAt: time.Now(),
		lastSeen:    time.Now(),
	}
	if replaced := h.registry.register(inst); replaced {
		log.Printf("tunnel: %s reconnected (previous session replaced)", inst.name)
	} else {
		log.Printf("tunnel: %s connected (version=%s)", inst.name, inst.version)
	}
	defer func() {
		h.registry.remove(inst.name, sess)
		log.Printf("tunnel: %s disconnected", inst.name)
	}()

	// Read heartbeats from the control stream until the client goes away.
	// yamux's own keepalive (default: 30s ping) handles transport-level
	// liveness; the heartbeat message updates the per-instance lastSeen
	// timestamp shown in the picker UI.
	for {
		var msg heartbeatMsg
		if err := dec.Decode(&msg); err != nil {
			if !errors.Is(err, io.EOF) {
				log.Printf("tunnel: %s control read: %v", inst.name, err)
			}
			return
		}
		if msg.Type == "heartbeat" {
			h.registry.heartbeat(inst.name)
		}
	}
}
