package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// wakeHandler proxies to the per-host wake URL (typically a Home
// Assistant webhook). The instance must be registered (live or stale);
// if not, returns 404. If the instance has no wake_url configured,
// returns 422.
//
// The wake URL is invoked with a POST and an empty body. Whatever Home
// Assistant returns is forwarded back to the caller, plus a small JSON
// summary the picker UI can show.
type wakeHandler struct {
	registry *registry
}

type wakeResponse struct {
	OK              bool   `json:"ok"`
	UpstreamStatus  int    `json:"upstream_status,omitempty"`
	UpstreamMessage string `json:"upstream_message,omitempty"`
	Error           string `json:"error,omitempty"`
}

var wakeClient = &http.Client{
	Timeout: 10 * time.Second,
}

func (h *wakeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	inst := h.registry.get(name)
	if inst == nil {
		writeWakeJSON(w, http.StatusNotFound, wakeResponse{
			Error: "no such backend",
		})
		return
	}
	if inst.wakeURL == "" {
		writeWakeJSON(w, http.StatusUnprocessableEntity, wakeResponse{
			Error: "backend has no wake_url configured",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, inst.wakeURL, nil)
	if err != nil {
		writeWakeJSON(w, http.StatusInternalServerError, wakeResponse{
			Error: err.Error(),
		})
		return
	}
	resp, err := wakeClient.Do(req)
	if err != nil {
		// Timeout, connection refused, etc. Surface the cause but report
		// 502 -- the gateway itself worked, the upstream did not.
		if errors.Is(err, context.DeadlineExceeded) {
			err = errors.New("upstream timeout")
		}
		log.Printf("wake: %s -> %s failed: %v", name, inst.wakeURL, err)
		writeWakeJSON(w, http.StatusBadGateway, wakeResponse{
			Error: err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Read up to 4 KB of upstream body so we can echo something useful
	// back without buffering arbitrary payloads.
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	msg := strings.TrimSpace(string(body))

	ok := resp.StatusCode >= 200 && resp.StatusCode < 300
	status := http.StatusOK
	if !ok {
		status = http.StatusBadGateway
	}
	log.Printf("wake: %s -> %s status=%d", name, inst.wakeURL, resp.StatusCode)
	writeWakeJSON(w, status, wakeResponse{
		OK:              ok,
		UpstreamStatus:  resp.StatusCode,
		UpstreamMessage: msg,
	})
}

func writeWakeJSON(w http.ResponseWriter, status int, body wakeResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
