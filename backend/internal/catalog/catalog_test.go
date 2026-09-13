package catalog

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/core"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
)

func TestLoadCoreHTTPRequiresToken(t *testing.T) {
	path := writeYAML(t, `
version: 1
backends:
  - code: core
    kind: core-http
    display_name: Core
    base_url: http://127.0.0.1:18083
    token_env: CORE_ADMIN_API_TOKEN
    timeout: 5s
    products:
      - code: lead-status
        display_name: Statuses
`)
	_, err := Load(path, Options{LookupEnv: func(string) (string, bool) { return "", false }})
	if err == nil || !strings.Contains(err.Error(), "CORE_ADMIN_API_TOKEN is required") {
		t.Fatalf("error=%v", err)
	}
}

func TestLoadCoreHTTP(t *testing.T) {
	path := writeYAML(t, `
version: 1
backends:
  - code: core
    kind: core-http
    display_name: Core
    base_url: http://127.0.0.1:18083
    token_env: CORE_ADMIN_API_TOKEN
    timeout: 5s
    health_path: /admin/v1/backend
    products:
      - code: lead-status
        display_name: Statuses
`)
	reg, err := Load(path, Options{
		LookupEnv: func(string) (string, bool) { return "test-token", true },
		CoreHTTP: func(opts core.Options) (*core.Client, error) {
			if opts.Token != "test-token" || opts.Code != "core" {
				t.Fatalf("opts=%+v", opts)
			}
			return core.New(opts)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(reg.Backends()) != 1 || reg.Backends()[0].Descriptor().Kind != adapter.KindCoreHTTP {
		t.Fatalf("backends=%v", reg.Backends())
	}
	if len(reg.Products()) != 1 || reg.Products()[0].Code != "lead-status" {
		t.Fatalf("products=%v", reg.Products())
	}
}

func TestLoadFixtureKind(t *testing.T) {
	path := writeYAML(t, `
version: 1
backends:
  - code: fixture
    kind: fixture
    display_name: Fixture
    products:
      - code: fixture-product
        display_name: Test
`)
	reg, err := Load(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	item, ok := reg.Get("fixture")
	if !ok || item.Adapter.Descriptor().Kind != adapter.KindFixture {
		t.Fatalf("item=%+v ok=%t", item, ok)
	}
	page, err := item.Adapter.ListAccounts(context.Background(), adapter.Actor{}, adapter.AccountFilter{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if page.Data == nil || page.Data.Total == nil || *page.Data.Total != 6 {
		t.Fatalf("demo accounts=%+v", page.Data)
	}
}

func TestLoadFixtureProfiles(t *testing.T) {
	path := writeYAML(t, `
version: 1
backends:
  - code: core
    kind: fixture
    profile: demo
    display_name: Fixture Core
    products:
      - code: lead-status
        display_name: Statuses
      - code: activity
        display_name: Activity
  - code: fixture
    kind: fixture
    profile: module
    display_name: Fixture Module
    timeout: 2s
    products:
      - code: fixture-module
        display_name: Demo module
      - code: lead-status
        display_name: Duplicate statuses
`)
	reg, err := Load(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	entries := reg.Entries()
	if len(entries) != 2 {
		t.Fatalf("entries=%d want 2", len(entries))
	}
	byCode := map[string]Backend{}
	for _, entry := range entries {
		byCode[entry.Code] = entry
	}

	demo, ok := byCode["core"]
	if !ok || demo.Kind != adapter.KindFixture || demo.Profile != "demo" {
		t.Fatalf("core=%+v ok=%t", demo, ok)
	}
	if caps := demo.Adapter.Capabilities(); !caps.Settings || !caps.Subscriptions {
		t.Fatalf("core adapter capabilities=%v", caps.Names())
	}

	module, ok := byCode["fixture"]
	if !ok || module.Kind != adapter.KindFixture || module.Profile != "module" {
		t.Fatalf("fixture=%+v ok=%t", module, ok)
	}
	if caps := module.Adapter.Capabilities(); caps.Settings || caps.Subscriptions {
		t.Fatalf("module adapter capabilities=%v", caps.Names())
	}

	products := reg.Products()
	codes := make([]string, 0, len(products))
	for _, product := range products {
		codes = append(codes, product.Code)
	}
	if !slices.Equal(codes, []string{"lead-status", "activity", "fixture-module"}) {
		t.Fatalf("products=%v", codes)
	}
}

func TestLoadFixtureProfileTimeout(t *testing.T) {
	path := writeYAML(t, `
version: 1
backends:
  - code: core
    kind: fixture
    profile: demo
    timeout: 2s
  - code: fixture
    kind: fixture
    profile: module
    timeout: 2s
`)
	reg, err := Load(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{"core", "fixture"} {
		item, ok := reg.Get(code)
		if !ok {
			t.Fatalf("backend %s missing", code)
		}
		if got := item.Adapter.Descriptor().Timeout; got != 2*time.Second {
			t.Fatalf("backend %s descriptor timeout=%v want 2s", code, got)
		}
	}
}

func TestLoadRejectsUnknownFixtureProfile(t *testing.T) {
	path := writeYAML(t, `
version: 1
backends:
  - code: fixture
    kind: fixture
    profile: bogus
`)
	_, err := Load(path, Options{})
	if err == nil || !strings.Contains(err.Error(), `unsupported fixture profile "bogus"`) {
		t.Fatalf("error=%v", err)
	}
}

func TestProbeReportsTwoFixtureBackends(t *testing.T) {
	reg := FromBackends(fixture.Demo("core"), fixture.Module("fixture"))
	results := probeResults(t, reg)
	if len(results) != 2 {
		t.Fatalf("results=%d want 2", len(results))
	}

	demo, ok := results["core"]
	if !ok {
		t.Fatalf("core missing in %v", results)
	}
	if demo.Kind != adapter.KindFixture || demo.Status != adapter.SourceAvailable || demo.Error != nil {
		t.Fatalf("core=%+v", demo)
	}
	if demo.ObservedAt == nil {
		t.Fatal("core observed_at is nil after a successful probe")
	}
	if !slices.Contains(demo.AdapterCapabilities, "settings") || !slices.Contains(demo.AdapterCapabilities, "subscriptions") {
		t.Fatalf("core adapter capabilities=%v", demo.AdapterCapabilities)
	}

	module, ok := results["fixture"]
	if !ok {
		t.Fatalf("fixture missing in %v", results)
	}
	if module.Kind != adapter.KindFixture || module.Status != adapter.SourceAvailable || module.Error != nil {
		t.Fatalf("fixture=%+v", module)
	}
	if module.ObservedAt == nil {
		t.Fatal("fixture observed_at is nil after a successful probe")
	}
	for _, capability := range []string{"settings", "subscriptions"} {
		if slices.Contains(module.AdapterCapabilities, capability) {
			t.Fatalf("module adapter capabilities must not contain %q: %v", capability, module.AdapterCapabilities)
		}
	}
	if module.Revision != "fixture-module" {
		t.Fatalf("module revision=%q", module.Revision)
	}
	if module.BackendCapabilities == nil {
		t.Fatal("module backend capabilities must be an empty slice, not nil")
	}
}

func TestProbeKeepsHealthyBackendWhenAnotherFails(t *testing.T) {
	reg := FromBackends(fixture.Demo("core"), fixture.Unavailable("fixture"))
	first := probeResults(t, reg)

	healthy := first["core"]
	if healthy.Status != adapter.SourceAvailable || healthy.ObservedAt == nil || healthy.Error != nil {
		t.Fatalf("core=%+v", healthy)
	}
	broken := first["fixture"]
	if broken.Status != adapter.SourceUnavailable {
		t.Fatalf("fixture status=%q", broken.Status)
	}
	if broken.Error == nil || broken.Error.Code != adapter.ErrorCodeUnavailable {
		t.Fatalf("fixture error=%+v", broken.Error)
	}
	if broken.ObservedAt != nil {
		t.Fatalf("unanswered backend must keep observed_at nil, got %v", broken.ObservedAt)
	}

	second := probeResults(t, reg)
	if second["core"].Status != adapter.SourceAvailable || second["core"].ObservedAt == nil {
		t.Fatalf("core after second probe=%+v", second["core"])
	}
	if !second["core"].ObservedAt.Equal(*healthy.ObservedAt) {
		t.Fatalf("core observed_at did not survive: first=%v second=%v", healthy.ObservedAt, second["core"].ObservedAt)
	}
	if second["fixture"].Status != adapter.SourceUnavailable || second["fixture"].Error == nil ||
		second["fixture"].Error.Code != adapter.ErrorCodeUnavailable {
		t.Fatalf("fixture after second probe=%+v", second["fixture"])
	}
}

func TestProbeRemembersLastSuccessAcrossFailures(t *testing.T) {
	flaky := &probeFakeAdapter{code: "flaky", timeout: time.Second}
	reg := FromBackends(flaky)
	reg.ProbeTTL = time.Millisecond

	first := probeResults(t, reg)["flaky"]
	if first.Status != adapter.SourceAvailable || first.ObservedAt == nil {
		t.Fatalf("first probe=%+v", first)
	}

	flaky.failing.Store(true)
	time.Sleep(5 * time.Millisecond)
	second := probeResults(t, reg)["flaky"]
	if second.Status != adapter.SourceUnavailable {
		t.Fatalf("status after failure=%q", second.Status)
	}
	if second.Error == nil || second.Error.Code != adapter.ErrorCodeUnavailable {
		t.Fatalf("error after failure=%+v", second.Error)
	}
	if second.ObservedAt == nil || !second.ObservedAt.Equal(*first.ObservedAt) {
		t.Fatalf("last success not remembered: first=%v second=%v", first.ObservedAt, second.ObservedAt)
	}
	if second.Revision != "probe-fake" || len(second.BackendCapabilities) == 0 {
		t.Fatalf("last health facts not remembered: %+v", second)
	}
}

func TestProbeCachesWithinTTL(t *testing.T) {
	fake := &probeFakeAdapter{code: "cached", timeout: time.Second}
	reg := FromBackends(fake)
	reg.ProbeTTL = 80 * time.Millisecond

	probeResults(t, reg)
	probeResults(t, reg)
	if calls := fake.calls.Load(); calls != 1 {
		t.Fatalf("Health calls within TTL=%d want 1", calls)
	}

	time.Sleep(120 * time.Millisecond)
	probeResults(t, reg)
	if calls := fake.calls.Load(); calls != 2 {
		t.Fatalf("Health calls after TTL=%d want 2", calls)
	}
}

func TestProbeDeduplicatesConcurrentProbes(t *testing.T) {
	fake := &probeFakeAdapter{
		code: "stampede", timeout: 5 * time.Second,
		entered: make(chan struct{}), gate: make(chan struct{}),
	}
	reg := FromBackends(fake)

	firstCh := make(chan map[string]ProbeResult, 1)
	go func() {
		firstCh <- collectProbeResults(reg.Probe(context.Background(), adapter.Actor{Value: "employee:fixture"}))
	}()
	<-fake.entered

	secondCh := make(chan map[string]ProbeResult, 1)
	go func() {
		secondCh <- collectProbeResults(reg.Probe(context.Background(), adapter.Actor{Value: "employee:fixture"}))
	}()
	close(fake.gate)

	first := <-firstCh
	second := <-secondCh
	if calls := fake.calls.Load(); calls != 1 {
		t.Fatalf("Health calls=%d want 1", calls)
	}
	firstResult := first["stampede"]
	secondResult := second["stampede"]
	if firstResult.Status != adapter.SourceAvailable || secondResult.Status != adapter.SourceAvailable {
		t.Fatalf("statuses: first=%q second=%q", firstResult.Status, secondResult.Status)
	}
	if firstResult.ObservedAt == nil || secondResult.ObservedAt == nil || !firstResult.ObservedAt.Equal(*secondResult.ObservedAt) {
		t.Fatalf("observed_at differs: first=%v second=%v", firstResult.ObservedAt, secondResult.ObservedAt)
	}
}

func TestProbeSlowAdapterTimesOut(t *testing.T) {
	slow := &probeFakeAdapter{code: "slow", timeout: 20 * time.Millisecond, delay: 500 * time.Millisecond}
	reg := FromBackends(slow)
	result := probeResults(t, reg)["slow"]

	if result.Status != adapter.SourceUnavailable {
		t.Fatalf("status=%q", result.Status)
	}
	if result.Error == nil || result.Error.Code != adapter.ErrorCodeTimeout {
		t.Fatalf("error=%+v", result.Error)
	}
	if result.ObservedAt != nil {
		t.Fatalf("timed out backend must keep observed_at nil, got %v", result.ObservedAt)
	}
	if calls := slow.calls.Load(); calls != 1 {
		t.Fatalf("Health calls=%d want 1", calls)
	}
}

func TestProbeWorksWithNilProbeMap(t *testing.T) {
	reg := &Registry{
		Version: 1,
		items: []Backend{{
			Code: "fixture", Kind: adapter.KindFixture, DisplayName: "fixture",
			Adapter: fixture.Demo("fixture"),
		}},
	}
	results := probeResults(t, reg)
	if len(results) != 1 || results["fixture"].Status != adapter.SourceAvailable {
		t.Fatalf("results=%+v", results)
	}
}

func probeResults(t *testing.T, reg *Registry) map[string]ProbeResult {
	t.Helper()
	return collectProbeResults(reg.Probe(context.Background(), adapter.Actor{Value: "employee:fixture"}))
}

func collectProbeResults(items []ProbeResult) map[string]ProbeResult {
	results := make(map[string]ProbeResult, len(items))
	for _, item := range items {
		results[item.Backend] = item
	}
	return results
}

type probeFakeAdapter struct {
	code    string
	timeout time.Duration
	delay   time.Duration
	calls   atomic.Int64
	failing atomic.Bool

	entered     chan struct{}
	enteredOnce sync.Once
	gate        chan struct{}
}

func (f *probeFakeAdapter) Descriptor() adapter.Descriptor {
	return adapter.Descriptor{
		Code: f.code, Kind: adapter.KindFixture,
		ContractVersion: adapter.ContractVersion, Timeout: f.timeout,
	}
}

func (f *probeFakeAdapter) Capabilities() adapter.Capabilities {
	return adapter.Capabilities{Accounts: true}
}

func (f *probeFakeAdapter) Health(ctx context.Context, _ adapter.Actor) (adapter.Observation[adapter.Health], error) {
	f.calls.Add(1)
	if f.entered != nil {
		f.enteredOnce.Do(func() { close(f.entered) })
	}
	if f.gate != nil {
		select {
		case <-f.gate:
		case <-ctx.Done():
			return adapter.Observation[adapter.Health]{}, ctx.Err()
		}
	}
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return adapter.Observation[adapter.Health]{}, ctx.Err()
		}
	}
	if f.failing.Load() {
		return adapter.Observation[adapter.Health]{}, adapter.Unavailable(f.code, "backend unavailable")
	}
	return adapter.Fresh(f.code, time.Now().UTC(), adapter.Health{
		Backend: f.code, Revision: "probe-fake", ContractVersion: adapter.ContractVersion,
		Capabilities: []string{"accounts"},
	}), nil
}

func (f *probeFakeAdapter) ListAccounts(context.Context, adapter.Actor, adapter.AccountFilter) (adapter.Observation[adapter.Page[adapter.Account]], error) {
	return adapter.Observation[adapter.Page[adapter.Account]]{}, nil
}

func (f *probeFakeAdapter) GetAccount(context.Context, adapter.Actor, int64) (adapter.Observation[adapter.Account], error) {
	return adapter.Observation[adapter.Account]{}, nil
}

func (f *probeFakeAdapter) ListConnections(context.Context, adapter.Actor, adapter.ConnectionFilter) (adapter.Observation[adapter.Page[adapter.ConnectionSummary]], error) {
	return adapter.Observation[adapter.Page[adapter.ConnectionSummary]]{}, nil
}

func (f *probeFakeAdapter) GetConnection(context.Context, adapter.Actor, string) (adapter.Observation[adapter.ConnectionDetail], error) {
	return adapter.Observation[adapter.ConnectionDetail]{}, nil
}

func (f *probeFakeAdapter) ListConnectionJobs(context.Context, adapter.Actor, string, adapter.JobFilter) (adapter.Observation[adapter.Page[adapter.Job]], error) {
	return adapter.Observation[adapter.Page[adapter.Job]]{}, nil
}

func (f *probeFakeAdapter) ListConnectionAudit(context.Context, adapter.Actor, string, adapter.PageFilter) (adapter.Observation[adapter.Page[adapter.AuditEntry]], error) {
	return adapter.Observation[adapter.Page[adapter.AuditEntry]]{}, nil
}

func (f *probeFakeAdapter) ListConnectionDeliveries(context.Context, adapter.Actor, string, adapter.PageFilter) (adapter.Observation[[]adapter.Delivery], error) {
	return adapter.Observation[[]adapter.Delivery]{}, nil
}

func (f *probeFakeAdapter) ListIntegrations(context.Context, adapter.Actor, adapter.PageFilter) (adapter.Observation[adapter.Page[adapter.Integration]], error) {
	return adapter.Observation[adapter.Page[adapter.Integration]]{}, nil
}

func (f *probeFakeAdapter) GetIntegration(context.Context, adapter.Actor, string) (adapter.Observation[adapter.Integration], error) {
	return adapter.Observation[adapter.Integration]{}, nil
}

func (f *probeFakeAdapter) ListJobs(context.Context, adapter.Actor, adapter.JobFilter) (adapter.Observation[adapter.Page[adapter.Job]], error) {
	return adapter.Observation[adapter.Page[adapter.Job]]{}, nil
}

func (f *probeFakeAdapter) GetJob(context.Context, adapter.Actor, string) (adapter.Observation[adapter.JobDetail], error) {
	return adapter.Observation[adapter.JobDetail]{}, nil
}

func (f *probeFakeAdapter) JobsSummary(context.Context, adapter.Actor) (adapter.Observation[adapter.JobsSummary], error) {
	return adapter.Observation[adapter.JobsSummary]{}, nil
}

func writeYAML(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "backends.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
