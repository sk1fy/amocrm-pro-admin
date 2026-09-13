package catalog

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/core"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/metrics"
)

const (
	defaultProbeTTL     = 10 * time.Second
	defaultProbeTimeout = 5 * time.Second
)

type File struct {
	Version  int
	Backends []Backend
}

type Backend struct {
	Code        string
	Kind        string
	Profile     string
	DisplayName string
	BaseURL     string
	TokenEnv    string
	Timeout     time.Duration
	HealthPath  string
	Products    []Product
	Adapter     adapter.Backend
}

type Product struct {
	Code        string `json:"code" yaml:"code"`
	DisplayName string `json:"display_name" yaml:"display_name"`
}

type Registry struct {
	Version int
	items   []Backend

	// ProbeTTL limits how often backend health is re-read. The last known
	// status and last successful response time are kept between probes.
	ProbeTTL time.Duration

	mu     sync.Mutex
	probes map[string]*probeState
}

// ProbeResult is one row of the backend registry: availability, adapter
// contract facts and the backend's last response.
type ProbeResult struct {
	Backend             string
	Kind                string
	DisplayName         string
	Products            []Product
	Status              string
	ContractVersion     string
	Revision            string
	AdapterCapabilities []string
	BackendCapabilities []string
	Components          any
	ObservedAt          *time.Time
	CheckedAt           time.Time
	Error               *adapter.ObsError
}

type probeState struct {
	status      string
	observedAt  *time.Time
	checkedAt   time.Time
	health      adapter.Health
	hasHealth   bool
	obsError    *adapter.ObsError
	initialized bool

	// probing guards against a probe stampede: while one Health call is in
	// flight, concurrent readers wait for probeDone instead of issuing their
	// own call.
	probing   bool
	probeDone chan struct{}
}

type Options struct {
	LookupEnv func(string) (string, bool)
	CoreHTTP  coreHTTP
	Fixtures  map[string]adapter.Backend
}

type coreHTTP func(core.Options) (*core.Client, error)

func Load(path string, opts Options) (*Registry, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" || path == "." {
		return nil, fmt.Errorf("BACKENDS_FILE is required")
	}
	raw, err := os.ReadFile(path) //nolint:gosec // G304: path is BACKENDS_FILE from process config.
	if err != nil {
		return nil, fmt.Errorf("read backends file: %w", err)
	}
	var parsed yamlFile
	if err := yaml.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("parse backends file: %w", err)
	}
	if parsed.Version != 1 {
		return nil, fmt.Errorf("backends file version must be 1")
	}
	lookup := opts.LookupEnv
	if lookup == nil {
		lookup = os.LookupEnv
	}
	newCore := opts.CoreHTTP
	if newCore == nil {
		newCore = core.New
	}
	items := make([]Backend, 0, len(parsed.Backends))
	seen := map[string]bool{}
	for _, cfg := range parsed.Backends {
		item, err := buildBackend(cfg, lookup, newCore, opts.Fixtures)
		if err != nil {
			return nil, err
		}
		if seen[item.Code] {
			return nil, fmt.Errorf("duplicate backend code %q", item.Code)
		}
		seen[item.Code] = true
		items = append(items, item)
	}
	return &Registry{
		Version:  parsed.Version,
		items:    items,
		ProbeTTL: defaultProbeTTL,
		probes:   map[string]*probeState{},
	}, nil
}

func FromBackends(backends ...adapter.Backend) *Registry {
	items := make([]Backend, 0, len(backends))
	for _, backend := range backends {
		desc := backend.Descriptor()
		items = append(items, Backend{
			Code:        desc.Code,
			Kind:        desc.Kind,
			DisplayName: desc.Code,
			Timeout:     desc.Timeout,
			Adapter:     backend,
		})
	}
	return &Registry{
		Version:  1,
		items:    items,
		ProbeTTL: defaultProbeTTL,
		probes:   map[string]*probeState{},
	}
}

// Probe reads health of every backend with its own timeout and remembers the
// outcome. The last successful response time and error survive later failures
// so the registry can show "last answered at" separately from "now failing".
func (r *Registry) Probe(ctx context.Context, actor adapter.Actor) []ProbeResult {
	if r == nil {
		return nil
	}
	now := time.Now().UTC()
	out := make([]ProbeResult, 0, len(r.items))
	for _, item := range r.items {
		r.mu.Lock()
		if r.probes == nil {
			r.probes = map[string]*probeState{}
		}
		state, ok := r.probes[item.Code]
		if !ok || state == nil {
			state = &probeState{}
			r.probes[item.Code] = state
		}
		cached := state.initialized && state.checkedAt.Add(r.probeTTL()).After(now)
		switch {
		case cached:
			r.mu.Unlock()
		case state.probing:
			done := state.probeDone
			r.mu.Unlock()
			if done != nil {
				select {
				case <-done:
				case <-ctx.Done():
				}
			}
		default:
			state.probing = true
			state.probeDone = make(chan struct{})
			r.mu.Unlock()
			r.probe(ctx, item, state, actor)
			r.mu.Lock()
			state.probing = false
			close(state.probeDone)
			state.probeDone = nil
			r.mu.Unlock()
		}
		r.mu.Lock()
		result := resultFrom(item, state)
		r.mu.Unlock()
		out = append(out, result)
	}
	return out
}

// probeOutcome maps a finalized probe result to the closed metrics outcome
// set: the canonical error code for failures, "available" for success and
// "unknown" when there is no data.
func probeOutcome(result ProbeResult) string {
	switch result.Status {
	case adapter.SourceAvailable:
		return metrics.OutcomeAvailable
	case adapter.SourceUnavailable:
		if result.Error != nil && result.Error.Code != "" {
			return result.Error.Code
		}
		return metrics.OutcomeBackendUnavailable
	default:
		return metrics.OutcomeUnknown
	}
}

func (r *Registry) probeTTL() time.Duration {
	if r.ProbeTTL <= 0 {
		return defaultProbeTTL
	}
	return r.ProbeTTL
}

func (r *Registry) probe(ctx context.Context, item Backend, state *probeState, actor adapter.Actor) {
	timeout := item.Adapter.Descriptor().Timeout
	if timeout <= 0 {
		timeout = item.Timeout
	}
	if timeout <= 0 {
		timeout = defaultProbeTimeout
	}
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	obs, err := item.Adapter.Health(callCtx, actor)
	checkedAt := time.Now().UTC()
	if err != nil && errors.Is(err, context.DeadlineExceeded) {
		err = adapter.Timeout(item.Code, "backend timed out")
	}

	r.mu.Lock()
	state.initialized = true
	state.checkedAt = checkedAt
	switch {
	case err != nil:
		state.status = adapter.SourceUnavailable
		state.obsError = adapter.ObsErrorFrom(err)
	case obs.Data == nil:
		state.status = adapter.SourceUnknown
		state.obsError = nil
	default:
		state.status = adapter.SourceAvailable
		state.obsError = nil
		state.health = *obs.Data
		state.hasHealth = true
		observedAt := obs.ObservedAt
		if observedAt.IsZero() {
			observedAt = checkedAt
		}
		observedAt = observedAt.UTC()
		state.observedAt = &observedAt
	}
	result := resultFrom(item, state)
	r.mu.Unlock()
	metrics.ObserveBackendProbe(result.Backend, probeOutcome(result), result.ObservedAt)
}

func resultFrom(item Backend, state *probeState) ProbeResult {
	result := ProbeResult{
		Backend:             item.Code,
		Kind:                item.Kind,
		DisplayName:         item.DisplayName,
		Products:            item.Products,
		Status:              state.status,
		ContractVersion:     item.Adapter.Descriptor().ContractVersion,
		AdapterCapabilities: item.Adapter.Capabilities().Names(),
		CheckedAt:           state.checkedAt,
		ObservedAt:          state.observedAt,
		Error:               state.obsError,
	}
	if state.status == "" {
		result.Status = adapter.SourceUnknown
	}
	if state.hasHealth {
		if state.health.ContractVersion != "" {
			result.ContractVersion = state.health.ContractVersion
		}
		result.Revision = state.health.Revision
		result.BackendCapabilities = state.health.Capabilities
		result.Components = state.health.Components
	}
	if result.Products == nil {
		result.Products = []Product{}
	}
	if result.AdapterCapabilities == nil {
		result.AdapterCapabilities = []string{}
	}
	return result
}

func (r *Registry) Backends() []adapter.Backend {
	if r == nil {
		return nil
	}
	out := make([]adapter.Backend, 0, len(r.items))
	for _, item := range r.items {
		out = append(out, item.Adapter)
	}
	return out
}

func (r *Registry) Entries() []Backend {
	if r == nil {
		return nil
	}
	out := make([]Backend, len(r.items))
	copy(out, r.items)
	return out
}

func (r *Registry) Get(code string) (Backend, bool) {
	if r == nil {
		return Backend{}, false
	}
	for _, item := range r.items {
		if item.Code == code {
			return item, true
		}
	}
	return Backend{}, false
}

func (r *Registry) Adapter(code string) (adapter.Backend, bool) {
	item, ok := r.Get(code)
	if !ok {
		return nil, false
	}
	return item.Adapter, true
}

func (r *Registry) Products() []Product {
	if r == nil {
		return nil
	}
	seen := map[string]Product{}
	order := make([]string, 0)
	for _, item := range r.items {
		for _, product := range item.Products {
			if _, ok := seen[product.Code]; ok {
				continue
			}
			seen[product.Code] = product
			order = append(order, product.Code)
		}
	}
	out := make([]Product, 0, len(order))
	for _, code := range order {
		out = append(out, seen[code])
	}
	return out
}

type yamlFile struct {
	Version  int           `yaml:"version"`
	Backends []yamlBackend `yaml:"backends"`
}

type yamlBackend struct {
	Code        string    `yaml:"code"`
	Kind        string    `yaml:"kind"`
	Profile     string    `yaml:"profile"`
	DisplayName string    `yaml:"display_name"`
	BaseURL     string    `yaml:"base_url"`
	TokenEnv    string    `yaml:"token_env"`
	Timeout     string    `yaml:"timeout"`
	HealthPath  string    `yaml:"health_path"`
	Products    []Product `yaml:"products"`
}

func buildBackend(cfg yamlBackend, lookup func(string) (string, bool), newCore coreHTTP, fixtures map[string]adapter.Backend) (Backend, error) {
	code := strings.TrimSpace(cfg.Code)
	kind := strings.TrimSpace(cfg.Kind)
	if code == "" {
		return Backend{}, fmt.Errorf("backend code is required")
	}
	timeout := 5 * time.Second
	if strings.TrimSpace(cfg.Timeout) != "" {
		parsed, err := time.ParseDuration(cfg.Timeout)
		if err != nil || parsed <= 0 {
			return Backend{}, fmt.Errorf("backend %s: timeout must be a positive duration", code)
		}
		timeout = parsed
	}
	item := Backend{
		Code:        code,
		Kind:        kind,
		Profile:     strings.TrimSpace(cfg.Profile),
		DisplayName: strings.TrimSpace(cfg.DisplayName),
		BaseURL:     strings.TrimSpace(cfg.BaseURL),
		TokenEnv:    strings.TrimSpace(cfg.TokenEnv),
		Timeout:     timeout,
		HealthPath:  strings.TrimSpace(cfg.HealthPath),
		Products:    cfg.Products,
	}
	if item.DisplayName == "" {
		item.DisplayName = code
	}
	switch kind {
	case adapter.KindCoreHTTP:
		if item.BaseURL == "" {
			return Backend{}, fmt.Errorf("backend %s: base_url is required", code)
		}
		if item.TokenEnv == "" {
			return Backend{}, fmt.Errorf("backend %s: token_env is required", code)
		}
		token, ok := lookup(item.TokenEnv)
		if !ok || strings.TrimSpace(token) == "" {
			return Backend{}, fmt.Errorf("backend %s: %s is required", code, item.TokenEnv)
		}
		client, err := newCore(core.Options{
			Code:       code,
			BaseURL:    item.BaseURL,
			Token:      token,
			Timeout:    timeout,
			HealthPath: item.HealthPath,
		})
		if err != nil {
			return Backend{}, err
		}
		item.Adapter = client
	case adapter.KindFixture:
		if backend, ok := fixtures[code]; ok {
			item.Adapter = backend
			break
		}
		switch item.Profile {
		case "", "demo":
			item.Adapter = fixture.DemoWithTimeout(code, timeout)
		case "module":
			item.Adapter = fixture.ModuleWithTimeout(code, timeout)
		default:
			return Backend{}, fmt.Errorf("backend %s: unsupported fixture profile %q", code, item.Profile)
		}
	default:
		return Backend{}, fmt.Errorf("backend %s: unsupported kind %q", code, kind)
	}
	return item, nil
}
