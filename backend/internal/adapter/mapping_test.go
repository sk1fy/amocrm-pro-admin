package adapter

import (
	"testing"
	"unicode/utf8"
)

func TestMapKnownDictionaries(t *testing.T) {
	tests := []struct {
		name  string
		mapFn func(string) State
		known []string
	}{
		{
			name:  "connection",
			mapFn: MapConnectionStatus,
			known: []string{"pending", "authorizing", "active", "reauth_required", "disabled", "uninstalled", "error"},
		},
		{
			name:  "webhook",
			mapFn: MapWebhookStatus,
			known: []string{"pending", "active", "disabled", "unregistered", "error"},
		},
		{
			name:  "job",
			mapFn: MapJobStatus,
			known: []string{"queued", "processing", "retry", "completed", "failed", "dead", "cancelled"},
		},
		{
			name:  "job outcome",
			mapFn: MapJobOutcome,
			known: []string{"completed", "retry", "failed", "dead", "cancelled", "lease_expired"},
		},
		{
			name:  "integration",
			mapFn: MapIntegrationStatus,
			known: []string{"active", "disabled"},
		},
		{
			name:  "outbox",
			mapFn: MapOutboxStatus,
			known: []string{"pending_delivery", "delivering", "accepted", "failed", "expired"},
		},
		{
			name:  "authorization",
			mapFn: MapAuthState,
			known: []string{"missing", "reauth_required", "refreshing", "expired_refreshable", "valid"},
		},
		{
			name:  "pilot",
			mapFn: MapPilot,
			known: []string{"enabled", "disabled", "not_configured"},
		},
		{
			name:  "origin",
			mapFn: MapOrigin,
			known: []string{"fixture", "real"},
		},
		{
			name:  "sync",
			mapFn: MapSyncState,
			known: []string{
				"pending", "idle", "running", "disabled", "paused",
				"failed", "reauth_required", "not_enabled",
			},
		},
		{
			name:  "lead-status run",
			mapFn: MapLeadStatusRun,
			known: []string{"queued", "processing", "completed", "failed", "dead"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			for _, value := range test.known {
				got := test.mapFn(value)
				if got.Canonical != value || got.Raw != "" {
					t.Fatalf("%s: %+v", value, got)
				}
			}
			got := test.mapFn("nope")
			if got.Canonical != StateUnknown || got.Raw != "nope" {
				t.Fatalf("unknown: %+v", got)
			}
			if got.Canonical == StatusActive {
				t.Fatal("unknown must not default to active")
			}
			empty := test.mapFn("")
			if empty.Canonical != StateUnknown || empty.Raw != "" {
				t.Fatalf("empty: %+v", empty)
			}
		})
	}
}

func TestMapSubscriptionState(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		canonical string
		stateRaw  string
	}{
		{name: "active", raw: "active", canonical: SubscriptionActive},
		{name: "trial", raw: "trial", canonical: SubscriptionTrial},
		{name: "expired", raw: "expired", canonical: SubscriptionExpired},
		{name: "cancelled", raw: "cancelled", canonical: SubscriptionCancelled},
		{name: "empty", raw: "", canonical: StateUnknown},
		{name: "grace period keeps raw", raw: "grace_period", canonical: StateUnknown, stateRaw: "grace_period"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := MapSubscriptionState(test.raw)
			if got.Canonical != test.canonical || got.Raw != test.stateRaw {
				t.Fatalf("MapSubscriptionState(%q)=%+v", test.raw, got)
			}
		})
	}
}

func TestMapSyncStateDoesNotInventActivity(t *testing.T) {
	if got := MapSyncState("not_enabled"); got.Canonical != SyncNotEnabled || got.Raw != "" {
		t.Fatalf("not_enabled: %+v", got)
	}
	if got := MapSyncState("partial"); got.Canonical != StateUnknown || got.Raw != "partial" {
		t.Fatalf("partial: %+v", got)
	}
	if got := MapSyncState("stale"); got.Canonical != StateUnknown || got.Raw != "stale" {
		t.Fatalf("stale: %+v", got)
	}
	if got := MapSyncState("idle"); got.Canonical != SyncIdle {
		t.Fatalf("idle: %+v", got)
	}
}

func TestMapGrant(t *testing.T) {
	if got := MapGrant(true); got.Canonical != GrantGranted || got.Raw != "" {
		t.Fatalf("enabled: %+v", got)
	}
	if got := MapGrant(false); got.Canonical != GrantNotGranted || got.Raw != "" {
		t.Fatalf("disabled: %+v", got)
	}
}

func TestRedactErrorStripsQueryAndTruncates(t *testing.T) {
	got := RedactError(" https://example.invalid/hook?key=secret-value leftover ")
	if got != "https://example.invalid/hook" {
		t.Fatalf("got %q", got)
	}
	long := make([]rune, maxErrorRunes+10)
	for i := range long {
		long[i] = 'a'
	}
	if got := RedactError(string(long)); utf8.RuneCountInString(got) != maxErrorRunes {
		t.Fatalf("len=%d", utf8.RuneCountInString(got))
	}
}
