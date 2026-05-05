package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/hashicorp/yamux"
)

// proxyHandler routes /backends/{name}/... to the named instance's tunnel.
// Path-prefix stripping: the backend sees the request at the same path it
// would if it were called directly (e.g. /backends/devbox/api/health
// becomes /api/health).
type proxyHandler struct {
	registry *registry
}

func (h *proxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// /backends/{name}/...  -> name = first segment after the prefix
	rest := strings.TrimPrefix(r.URL.Path, "/backends/")
	if rest == r.URL.Path {
		http.NotFound(w, r)
		return
	}
	slash := strings.IndexByte(rest, '/')
	var name, tail string
	if slash < 0 {
		name = rest
		tail = "/"
	} else {
		name = rest[:slash]
		tail = rest[slash:]
	}
	if name == "" {
		http.NotFound(w, r)
		return
	}

	inst := h.registry.get(name)
	if inst == nil || inst.session == nil || inst.session.IsClosed() {
		http.Error(w, fmt.Sprintf("backend %q not connected", name), http.StatusBadGateway)
		return
	}

	// httputil.ReverseProxy with a Transport that dials over yamux.
	// FlushInterval: -1 ensures SSE chunks are written to the client
	// immediately rather than buffered.
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			// Don't use SetURL: it joins paths, but we want a full
			// override (the prefix /backends/<name> has been stripped).
			// Scheme/host are placeholders -- the transport dials directly
			// through the tunnel and ignores them.
			pr.Out.URL = &url.URL{
				Scheme:   "http",
				Host:     "tunnel",
				Path:     tail,
				RawQuery: r.URL.RawQuery,
			}
			// Preserve original Host so the backend sees what the browser
			// sent (some Hono routes care).
			pr.Out.Host = r.Host
		},
		Transport:     inst.transport,
		FlushInterval: -1,
		ErrorLog:      log.New(log.Writer(), "proxy: ", log.LstdFlags),
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			// Tunnel-level errors (session closed mid-flight, stream
			// reset) are common during reconnects; report as 502.
			log.Printf("proxy: %s %s: %v", r.Method, r.URL.Path, err)
			http.Error(w, "bad gateway", http.StatusBadGateway)
		},
	}

	proxy.ServeHTTP(w, r)
}

// yamuxTransport is an http.RoundTripper that dials each request as a new
// stream on a shared yamux session. We keep a single http.Transport instance
// configured with DisableKeepAlives=true so each request gets a fresh stream
// (yamux streams are cheap; pooling them under HTTP keep-alive interacts
// badly with mid-stream session resets).
type yamuxTransport struct {
	session *yamux.Session
	inner   *http.Transport
}

func newYamuxTransport(sess *yamux.Session) *yamuxTransport {
	t := &yamuxTransport{session: sess}
	t.inner = &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return sess.Open()
		},
		DisableKeepAlives:     true,
		ResponseHeaderTimeout: 0, // SSE: unbounded time-to-first-byte
		ExpectContinueTimeout: 1 * 1_000_000_000,
	}
	return t
}

func (t *yamuxTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if t.session == nil || t.session.IsClosed() {
		return nil, errors.New("yamux session closed")
	}
	return t.inner.RoundTrip(req)
}
