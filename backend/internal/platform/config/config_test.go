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

func TestNormalizeOriginTrimsTrailingSlash(t *testing.T) {
	if got := NormalizeOrigin(" http://127.0.0.1:5173/ "); got != "http://127.0.0.1:5173" {
		t.Fatalf("got %q", got)
	}
}
