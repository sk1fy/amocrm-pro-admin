package catalog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/core"
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
