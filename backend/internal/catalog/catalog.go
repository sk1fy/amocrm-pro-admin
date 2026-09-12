package catalog

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/core"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
)

type File struct {
	Version  int
	Backends []Backend
}

type Backend struct {
	Code        string
	Kind        string
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
	return &Registry{Version: parsed.Version, items: items}, nil
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
	return &Registry{Version: 1, items: items}
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
		item.Adapter = fixture.Demo(code)
	default:
		return Backend{}, fmt.Errorf("backend %s: unsupported kind %q", code, kind)
	}
	return item, nil
}
