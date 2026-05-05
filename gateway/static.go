package main

import (
	"embed"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"strings"
)

// Embedded frontend bundle. Built by `npm run build` in frontend/, then
// copied into static/ here by the gateway's build pipeline (see
// scripts/build-release.sh / Dockerfile).
//
// embed:all is required to include hashed asset filenames (otherwise
// files starting with "_" or "." would be excluded).
//
//go:embed all:static
var embeddedFS embed.FS

// staticHandler serves the embedded frontend with SPA fallback to
// index.html for any path that doesn't match an asset.
//
// In dev (or for hot-iteration of just the frontend), set VPGW_FRONTEND_DIR
// to a directory on disk; the gateway will serve from there instead of the
// embedded copy.
func newStaticHandler() (http.Handler, error) {
	if dir := os.Getenv("VPGW_FRONTEND_DIR"); dir != "" {
		return spaFileServer(http.Dir(dir)), nil
	}
	sub, err := fs.Sub(embeddedFS, "static")
	if err != nil {
		return nil, err
	}
	// Detect "no frontend bundled" so we can give a clear error rather than
	// 404-ing at runtime (this happens when the gateway is built without
	// the build step that copies frontend/dist into gateway/static/).
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, errors.New("no embedded frontend (gateway/static/index.html missing); rebuild after `npm run build` in frontend/")
	}
	return spaFileServer(http.FS(sub)), nil
}

// spaFileServer serves files from the given FS, falling back to /index.html
// for any path that doesn't resolve to a file (so the SolidJS router can
// pick it up client-side).
func spaFileServer(root http.FileSystem) http.Handler {
	fileSrv := http.FileServer(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to open the requested path. If it doesn't exist, serve
		// index.html instead -- the SPA router will handle it.
		// Skip the fallback for asset-style paths (anything with an
		// extension): those should 404 cleanly so the browser doesn't
		// try to interpret HTML as JS or CSS.
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			fileSrv.ServeHTTP(w, r)
			return
		}
		f, err := root.Open(path)
		if err == nil {
			f.Close()
			fileSrv.ServeHTTP(w, r)
			return
		}
		if hasExt(path) {
			http.NotFound(w, r)
			return
		}
		// SPA fallback: rewrite to index.html.
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/"
		fileSrv.ServeHTTP(w, r2)
	})
}

func hasExt(path string) bool {
	// Last segment after the last '/'.
	if i := strings.LastIndexByte(path, '/'); i >= 0 {
		path = path[i+1:]
	}
	return strings.LastIndexByte(path, '.') >= 0
}
