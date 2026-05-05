package main

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/hashicorp/yamux"
)

// instance is a single registered backend, with its yamux session if connected.
//
// Lifecycle: created on tunnel connect (registerControl), updated by heartbeats,
// removed on tunnel disconnect. Phase 1 keeps no on-disk state; if the gateway
// restarts, registrations are lost (clients reconnect within seconds).
type instance struct {
	name        string
	wakeURL     string // optional HA webhook; nil for now in phase 1
	version     string
	session     *yamux.Session
	transport   *yamuxTransport // built once per session
	connectedAt time.Time
	lastSeen    time.Time
}

type registry struct {
	mu               sync.RWMutex
	instances        map[string]*instance
	heartbeatTimeout time.Duration
}

func newRegistry(heartbeatTimeout time.Duration) *registry {
	return &registry{
		instances:        map[string]*instance{},
		heartbeatTimeout: heartbeatTimeout,
	}
}

// register installs (or replaces) an instance. If a previous session exists
// for the same name, it is closed -- last-write-wins, with a warning logged
// by the caller.
func (r *registry) register(inst *instance) (replaced bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	old, existed := r.instances[inst.name]
	if existed && old.session != nil {
		_ = old.session.Close()
		replaced = true
	}
	r.instances[inst.name] = inst
	return
}

// remove drops an instance, but only if the recorded session matches the one
// passed in. This avoids races where a reconnect installs a new session
// between the time the old session's read loop exits and we get here.
func (r *registry) remove(name string, sess *yamux.Session) {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.instances[name]
	if !ok || inst.session != sess {
		return
	}
	delete(r.instances, name)
}

func (r *registry) get(name string) *instance {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.instances[name]
}

func (r *registry) heartbeat(name string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.instances[name]
	if !ok {
		return false
	}
	inst.lastSeen = time.Now()
	return true
}

func (r *registry) closeAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, inst := range r.instances {
		if inst.session != nil {
			_ = inst.session.Close()
		}
	}
}

// instanceView is the JSON shape returned by /api/gateway/instances.
// Stable wire format -- the frontend depends on these field names.
type instanceView struct {
	Name        string    `json:"name"`
	Version     string    `json:"version"`
	Online      bool      `json:"online"`
	HasWake     bool      `json:"has_wake"`
	ConnectedAt time.Time `json:"connected_at"`
	LastSeen    time.Time `json:"last_seen"`
}

func (r *registry) snapshot() []instanceView {
	r.mu.RLock()
	defer r.mu.RUnlock()
	now := time.Now()
	out := make([]instanceView, 0, len(r.instances))
	for _, inst := range r.instances {
		online := inst.session != nil &&
			!inst.session.IsClosed() &&
			now.Sub(inst.lastSeen) <= r.heartbeatTimeout
		out = append(out, instanceView{
			Name:        inst.name,
			Version:     inst.version,
			Online:      online,
			HasWake:     inst.wakeURL != "",
			ConnectedAt: inst.connectedAt,
			LastSeen:    inst.lastSeen,
		})
	}
	return out
}

func writeInstances(w http.ResponseWriter, r *registry) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(r.snapshot())
}
