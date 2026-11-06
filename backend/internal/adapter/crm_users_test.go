package adapter_test

import (
	"context"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
)

func TestMapCRMUsersState(t *testing.T) {
	for _, raw := range []string{"ok", "no_authorized_connection", "auth_error", "rate_limited", "incomplete", "network_error", "internal_error"} {
		if got := adapter.MapCRMUsersState(raw); got.Canonical != raw || got.Raw != "" {
			t.Fatalf("MapCRMUsersState(%q)=%+v", raw, got)
		}
	}
	if got := adapter.MapCRMUsersState("throttled"); got.Canonical != adapter.StateUnknown || got.Raw != "throttled" {
		t.Fatalf("unknown state=%+v", got)
	}
}

func TestAsCRMUsersRequiresCapability(t *testing.T) {
	if users, ok := adapter.AsCRMUsers(nil); users != nil || ok {
		t.Fatalf("AsCRMUsers(nil)=%v,%t", users, ok)
	}
	if _, ok := adapter.AsCRMUsers(fixture.Demo("core")); !ok {
		t.Fatal("demo fixture must expose crm users")
	}
	caps := adapter.Capabilities{Accounts: true}
	if _, ok := adapter.AsCRMUsers(fixture.New(fixture.Options{Code: "module", Caps: &caps})); ok {
		t.Fatal("backend without crm-users capability must not expose crm users")
	}
}

func TestGatherWithinUsesCallerTimeout(t *testing.T) {
	backend := fixture.New(fixture.Options{Code: "core", Timeout: 10 * time.Millisecond})
	gathered := adapter.GatherWithin(context.Background(), []adapter.Backend{backend},
		func(adapter.Backend) time.Duration { return 2 * time.Second },
		func(ctx context.Context, _ adapter.Backend) (adapter.Observation[int], error) {
			deadline, ok := ctx.Deadline()
			if !ok || time.Until(deadline) < time.Second {
				t.Errorf("deadline=%v ok=%t, want caller timeout", deadline, ok)
			}
			return adapter.Fresh("core", time.Now(), 1), nil
		})
	if len(gathered.Items) != 1 || len(gathered.Sources) != 1 || gathered.Sources[0].Status != adapter.SourceAvailable {
		t.Fatalf("gathered=%+v", gathered)
	}
}
