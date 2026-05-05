package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/hashicorp/yamux"
)

// instance is a single registered backend, with its yamux session if connected.
//
// Lifecycle:
//   - Created or revived on tunnel connect (tunnel.go)
//   - Updated by heartbeats
//   - session/transport go nil on disconnect, but the entry stays so we
//     can wake it with the persisted wake_url
type instance struct {
	name        string
	wakeURL     string // optional HA webhook
	version     string
	session     *yamux.Session  // nil when disconnected
	transport   *yamuxTransport // nil when disconnected
	connectedAt time.Time
	lastSeen    time.Time
}

// instanceRecord is the on-disk shape -- only the fields that survive
// gateway restarts. The live session/transport can't be persisted; they're
// rebuilt when the tunnel client reconnects.
type instanceRecord struct {
	Name    string `json:"name"`
	WakeURL string `json:"wake_url,omitempty"`
	Version string `json:"version,omitempty"`
}

type registry struct {
	mu               sync.RWMutex
	instances        map[string]*instance
	heartbeatTimeout time.Duration
	dataDir          string // empty = no persistence
}

func newRegistry(heartbeatTimeout time.Duration, dataDir string) *registry {
	r := &registry{
		instances:        map[string]*instance{},
		heartbeatTimeout: heartbeatTimeout,
		dataDir:          dataDir,
	}
	if dataDir != "" {
		if err := r.load(); err != nil {
			log.Printf("registry: load failed: %v", err)
		}
	}
	return r
}

// register installs (or revives) an instance. If a previous live session
// existed for the same name, it is closed -- last-write-wins.
func (r *registry) register(inst *instance) (replaced bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	old, existed := r.instances[inst.name]
	if existed && old.session != nil {
		_ = old.session.Close()
		replaced = true
	}
	r.instances[inst.name] = inst
	r.persistLocked()
	return
}

// markDisconnected drops the live session/transport for an instance but
// keeps its persisted record (name, wake_url, version) so it's still
// listable / wakable by name.
func (r *registry) markDisconnected(name string, sess *yamux.Session) {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.instances[name]
	if !ok || inst.session != sess {
		// Either the instance was already replaced by a newer connection,
		// or it never existed; nothing to do.
		return
	}
	inst.session = nil
	inst.transport = nil
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

// persistLocked writes the current instance set to disk. Caller must
// hold r.mu (write lock). Errors are logged, not returned -- registry
// state is more important than disk durability here.
func (r *registry) persistLocked() {
	if r.dataDir == "" {
		return
	}
	records := make([]instanceRecord, 0, len(r.instances))
	for _, inst := range r.instances {
		records = append(records, instanceRecord{
			Name:    inst.name,
			WakeURL: inst.wakeURL,
			Version: inst.version,
		})
	}
	if err := os.MkdirAll(r.dataDir, 0o755); err != nil {
		log.Printf("registry: mkdir %s: %v", r.dataDir, err)
		return
	}
	path := filepath.Join(r.dataDir, "instances.json")
	tmp := path + ".tmp"
	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		log.Printf("registry: marshal: %v", err)
		return
	}
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		log.Printf("registry: write %s: %v", tmp, err)
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		log.Printf("registry: rename %s -> %s: %v", tmp, path, err)
	}
}

func (r *registry) load() error {
	path := filepath.Join(r.dataDir, "instances.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	var records []instanceRecord
	if err := json.Unmarshal(data, &records); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, rec := range records {
		// Restored instances start in disconnected state; tunnel clients
		// will revive them on next register.
		r.instances[rec.Name] = &instance{
			name:    rec.Name,
			wakeURL: rec.WakeURL,
			version: rec.Version,
		}
	}
	log.Printf("registry: loaded %d persisted instance(s) from %s", len(records), path)
	return nil
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
