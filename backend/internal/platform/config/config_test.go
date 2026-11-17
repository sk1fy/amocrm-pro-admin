package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadAPIRequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	_, err := LoadAPI()
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL is required") {
		t.Fatalf("error = %v", err)
	}
}

func TestLoadAPIDevelopmentDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://admin:admin@example.invalid:5432/admin")
	t.Setenv("APP_ENV", "development")
	t.Setenv("ADMIN_PUBLIC_ORIGIN", "")

	cfg, err := LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTPAddress != defaultHTTPAddress || cfg.ManagementHTTPAddress != defaultManagementAddress {
		t.Fatalf("listeners = %q %q", cfg.HTTPAddress, cfg.ManagementHTTPAddress)
	}
	if cfg.AdminPublicOrigin != defaultPublicOrigin {
		t.Fatalf("origin = %q", cfg.AdminPublicOrigin)
	}
	if cfg.CookieSecure {
		t.Fatal("Secure cookie must be disabled in development")
	}
	if cfg.SessionAbsoluteTTL != 12*time.Hour || cfg.SessionIdleTTL != 2*time.Hour {
		t.Fatalf("ttls = %s %s", cfg.SessionAbsoluteTTL, cfg.SessionIdleTTL)
	}
	if cfg.LoginRatePerMinute != 10 {
		t.Fatalf("login rate = %d", cfg.LoginRatePerMinute)
	}
}

func TestLoadAPIProductionRequiresOrigin(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://admin:admin@example.invalid:5432/admin")
	t.Setenv("APP_ENV", "production")
	t.Setenv("ADMIN_PUBLIC_ORIGIN", "")
	_, err := LoadAPI()
	if err == nil || !strings.Contains(err.Error(), "ADMIN_PUBLIC_ORIGIN is required") {
		t.Fatalf("error = %v", err)
	}
}

func TestLoadAPIProductionEnablesSecureCookie(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://admin:admin@example.invalid:5432/admin")
	t.Setenv("APP_ENV", "production")
	t.Setenv("ADMIN_PUBLIC_ORIGIN", "https://admin.example.invalid")

	cfg, err := LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.CookieSecure {
		t.Fatal("Secure cookie must be enabled in production")
	}
}

func TestLoadAPIRejectsListenerConflict(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://admin:admin@example.invalid:5432/admin")
	t.Setenv("APP_ENV", "development")
	t.Setenv("HTTP_ADDRESS", ":8090")
	t.Setenv("MANAGEMENT_HTTP_ADDRESS", ":8090")
	_, err := LoadAPI()
	if err == nil || !strings.Contains(err.Error(), "must not conflict") {
		t.Fatalf("error = %v", err)
	}
}

func TestLoadAPIAllowsEmptyObservabilityURLs(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://admin:admin@example.invalid:5432/admin")
	t.Setenv("APP_ENV", "development")
	t.Setenv("GRAFANA_BASE_URL", "")
	t.Setenv("LOKI_BASE_URL", "https://loki.example.invalid")
	cfg, err := LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GrafanaBaseURL != "" || cfg.LokiBaseURL != "https://loki.example.invalid" {
		t.Fatalf("observability=%q %q", cfg.GrafanaBaseURL, cfg.LokiBaseURL)
	}
}

func TestNormalizeOriginTrimsTrailingSlash(t *testing.T) {
	if got := NormalizeOrigin(" http://127.0.0.1:5173/ "); got != "http://127.0.0.1:5173" {
		t.Fatalf("got %q", got)
	}
}

func TestLoadAPITrustProxyDefaultsToFalse(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://admin:admin@example.invalid:5432/admin")
	t.Setenv("APP_ENV", "development")
	t.Setenv("TRUST_PROXY_HEADERS", "")

	cfg, err := LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.TrustProxy {
		t.Fatal("proxy headers must not be trusted by default")
	}
}

func TestLoadAPITrustProxyEnabled(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://admin:admin@example.invalid:5432/admin")
	t.Setenv("APP_ENV", "development")
	t.Setenv("TRUST_PROXY_HEADERS", "true")

	cfg, err := LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.TrustProxy {
		t.Fatal("expected proxy headers to be trusted")
	}
}

func TestLoadAPIRejectsInvalidTrustProxy(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://admin:admin@example.invalid:5432/admin")
	t.Setenv("APP_ENV", "development")
	t.Setenv("TRUST_PROXY_HEADERS", "sometimes")

	_, err := LoadAPI()
	if err == nil || !strings.Contains(err.Error(), "TRUST_PROXY_HEADERS") {
		t.Fatalf("error = %v", err)
	}
}

func TestManagerOriginRequiresDedicatedHTTPSHost(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://admin:admin@example.invalid:5432/admin")
	t.Setenv("APP_ENV", "production")
	t.Setenv("ADMIN_PUBLIC_ORIGIN", "https://admin.example.invalid")
	for _, tc := range []struct {
		origin string
		want   string
	}{
		{"", ""},
		{"https://MANAGERS.example.invalid:443/", "https://managers.example.invalid"},
		{"https://managers.example.invalid:65536", "error"},
		{"http://managers.example.invalid", "error"},
		{"https://admin.example.invalid:444", "error"},
		{"https://managers.example.invalid/path", "error"},
		{"https://employee@managers.example.invalid", "error"},
	} {
		t.Run(tc.origin, func(t *testing.T) {
			t.Setenv("MANAGERS_PUBLIC_ORIGIN", tc.origin)
			cfg, err := LoadAPI()
			if tc.want == "error" {
				if err == nil || !strings.Contains(err.Error(), "MANAGERS_PUBLIC_ORIGIN") {
					t.Fatalf("expected a manager origin error, got %v", err)
				}
				return
			}
			if err != nil || cfg.ManagerPublicOrigin != tc.want {
				t.Fatalf("manager origin = %q, err = %v, want %q", cfg.ManagerPublicOrigin, err, tc.want)
			}
		})
	}
}

func TestManagerPlatformConfigurationIsAllOrNothing(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://admin:admin@example.invalid:5432/admin")
	t.Setenv("APP_ENV", "production")
	t.Setenv("ADMIN_PUBLIC_ORIGIN", "https://admin.example.invalid")
	t.Setenv("MANAGERS_PUBLIC_ORIGIN", "https://managers.example.invalid")
	t.Setenv("MANAGERS_PLATFORM_URL", "https://platform.example.invalid:8443")
	t.Setenv("MANAGERS_PLATFORM_CA_FILE", "/fixture/ca.pem")
	t.Setenv("MANAGERS_PLATFORM_CERT_FILE", "/fixture/bff.pem")
	t.Setenv("MANAGERS_PLATFORM_KEY_FILE", "")
	t.Setenv("MANAGERS_PLATFORM_TIMEOUT", "15s")
	if _, err := LoadAPI(); err == nil {
		t.Fatal("accepted a Platform connection with partial mTLS configuration")
	}

	t.Setenv("MANAGERS_PLATFORM_KEY_FILE", "/fixture/bff.key")
	cfg, err := LoadAPI()
	if err != nil || cfg.ManagerPlatform.Timeout != 15*time.Second || cfg.ManagerPlatform.URL != "https://platform.example.invalid:8443" {
		t.Fatalf("configured Platform connection = %+v, %v", cfg.ManagerPlatform, err)
	}

	t.Setenv("MANAGERS_PLATFORM_TIMEOUT", "31s")
	if _, err := LoadAPI(); err == nil {
		t.Fatal("accepted a Platform timeout above the actor envelope deadline limit")
	}
	t.Setenv("MANAGERS_PLATFORM_TIMEOUT", "30s")
	t.Setenv("MANAGERS_PUBLIC_ORIGIN", "")
	if _, err := LoadAPI(); err == nil {
		t.Fatal("accepted a Platform connection without a dedicated managers host")
	}
}
