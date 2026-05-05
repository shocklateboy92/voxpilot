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

// proxyHandler routes /backends/{name}/{api|oc|mcp}/... to the named
// instance's tunnel. Anything else under /backends/{name}/ is the
// frontend (handled by the static handler with SPA fallback).
//
// Path-prefix stripping: /backends/devbox/api/health becomes /api/health
// at the backend. The original Host header is preserved.
type proxyHandler struct {
	registry *registry
	// next is the handler to fall back to when the path is under
	// /backends/<name>/ but not one of the proxied subpaths -- i.e.,
	// requests for the SPA itself. Typically the static file server.
	next http.Handler
}

// proxiedSubpaths are the path segments (immediately after the backend
// name) that get tunneled to the backend. Everything else under
// /backends/<name>/ is served by the SPA (index.html with SPA fallback).
var proxiedSubpaths = []string{"api", "oc", "mcp"}

func (h *proxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// /backends/{name}/{...}  -- name is the first segment, then "/".
	rest := strings.TrimPrefix(r.URL.Path, "/backends/")
	if rest == r.URL.Path {
		// Shouldn't happen given the mux pattern, but be defensive.
		h.next.ServeHTTP(w, r)
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

	// Decide whether to tunnel or to serve the SPA. The first segment of
	// `tail` after the leading slash determines this.
	tailFirst := ""
	if len(tail) > 1 {
		if i := strings.IndexByte(tail[1:], '/'); i >= 0 {
			tailFirst = tail[1 : 1+i]
		} else {
			tailFirst = tail[1:]
		}
	}
	isProxied := false
	for _, p := range proxiedSubpaths {
		if tailFirst == p {
			isProxied = true
			break
		}
	}
	if !isProxied {
		// SPA fallback. Strip just /backends/<name> so the static handler
		// resolves assets and falls back to index.html. Asset requests
		// (e.g. /backends/devbox/assets/main.js) thus resolve to the
		// static FS at /assets/main.js.
		r2 := r.Clone(r.Context())
		r2.URL.Path = tail
		h.next.ServeHTTP(w, r2)
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
