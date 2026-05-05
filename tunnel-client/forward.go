package main

import (
	"errors"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sync"
)

// forwarder turns inbound yamux streams into HTTP requests against the
// local backend. Each stream carries a single HTTP/1.1 request/response.
type forwarder struct {
	target *url.URL
	proxy  *httputil.ReverseProxy
}

func newForwarder(localURL string) *forwarder {
	target, err := url.Parse(localURL)
	if err != nil {
		// Validated already in runOnce, but be defensive.
		log.Fatalf("invalid local URL %q: %v", localURL, err)
	}
	f := &forwarder{target: target}
	f.proxy = &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL.Scheme = target.Scheme
			pr.Out.URL.Host = target.Host
			// Preserve path and query as the gateway sent them. The gateway
			// has already stripped the /backends/<name> prefix.
			pr.Out.Host = target.Host
		},
		FlushInterval: -1, // SSE: flush each chunk immediately
		ErrorLog:      log.New(log.Writer(), "fwd: ", log.LstdFlags),
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("fwd: %s %s: %v", r.Method, r.URL.Path, err)
			http.Error(w, "local backend unreachable", http.StatusBadGateway)
		},
	}
	return f
}

// serve handles one inbound stream as a single HTTP request.
//
// Implementation: wrap the stream as a one-shot net.Listener and run
// http.Server.Serve on it. http.Server handles HTTP/1.1 framing, the
// reverse proxy forwards to the local backend, the response is written
// back through the same stream. After the request completes, http.Server
// closes the connection (no keep-alive across yamux streams; the gateway
// opens a new stream per request) and Serve returns ErrServerClosed
// because the listener has already been drained.
func (f *forwarder) serve(stream net.Conn) {
	defer stream.Close()

	ln := &oneShotListener{conn: stream}
	srv := &http.Server{
		Handler: f.proxy,
		// Disable keep-alive: each stream serves exactly one request.
		// (Even with this off http.Server doesn't proactively close after
		// one request -- the listener returning EOF does.)
		ErrorLog: log.New(log.Writer(), "stream-srv: ", log.LstdFlags),
	}
	srv.SetKeepAlivesEnabled(false)
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) && !errors.Is(err, errListenerClosed) {
		// Non-fatal; the gateway will treat as 502 on its side.
		log.Printf("fwd: serve: %v", err)
	}
}

// oneShotListener returns its single conn on the first Accept call,
// then ErrListenerClosed forever after.
type oneShotListener struct {
	once   sync.Once
	conn   net.Conn
	closed chan struct{}
	init   sync.Once
}

var errListenerClosed = errors.New("one-shot listener closed")

func (l *oneShotListener) ensureInit() {
	l.init.Do(func() { l.closed = make(chan struct{}) })
}

func (l *oneShotListener) Accept() (net.Conn, error) {
	l.ensureInit()
	var c net.Conn
	l.once.Do(func() { c = l.conn })
	if c != nil {
		return c, nil
	}
	<-l.closed
	return nil, errListenerClosed
}

func (l *oneShotListener) Close() error {
	l.ensureInit()
	select {
	case <-l.closed:
	default:
		close(l.closed)
	}
	return nil
}

func (l *oneShotListener) Addr() net.Addr {
	if l.conn != nil {
		return l.conn.LocalAddr()
	}
	return dummyAddr{}
}

type dummyAddr struct{}

func (dummyAddr) Network() string { return "yamux" }
func (dummyAddr) String() string  { return "yamux-stream" }
