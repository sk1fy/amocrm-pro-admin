package fixture

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

func TestCRMUsersSnapshot(t *testing.T) {
	fx := Demo("core")
	obs, err := fx.GetCRMUsers(context.Background(), adapter.Actor{}, 91000001)
	if err != nil || obs.Data == nil {
		t.Fatalf("crm users err=%v", err)
	}
	data := *obs.Data
	if obs.Freshness != adapter.FreshnessFresh || data.State.Canonical != adapter.CRMUsersOK {
		t.Fatalf("observation=%+v data=%+v", obs, data)
	}
	if data.Total == nil || *data.Total != len(data.Users) || len(data.Users) != 3 {
		t.Fatalf("total=%v users=%+v", data.Total, data.Users)
	}
	if data.FreshUntil == nil || !data.FreshUntil.After(obs.ObservedAt) {
		t.Fatalf("fresh_until=%v observed_at=%v", data.FreshUntil, obs.ObservedAt)
	}
	if data.Connection == nil || data.Connection.ID != installationID(1) {
		t.Fatalf("connection=%+v", data.Connection)
	}
	data.Users[0].Name = "mutated"
	again, _ := fx.GetCRMUsers(context.Background(), adapter.Actor{}, 91000001)
	if again.Data.Users[0].Name == "mutated" {
		t.Fatal("snapshot must not share users with callers")
	}
}

func TestCRMUsersUnknownListStates(t *testing.T) {
	fx := Demo("core")
	limited, err := fx.GetCRMUsers(context.Background(), adapter.Actor{}, 91000002)
	if err != nil || limited.Data == nil {
		t.Fatalf("rate limited err=%v", err)
	}
	if limited.Data.State.Canonical != adapter.CRMUsersRateLimited || limited.Data.Users != nil || limited.Data.Total != nil {
		t.Fatalf("rate limited=%+v", limited.Data)
	}
	if limited.Data.RetryAfter == nil || *limited.Data.RetryAfter != 30*time.Second {
		t.Fatalf("retry_after=%v", limited.Data.RetryAfter)
	}
	none, err := fx.GetCRMUsers(context.Background(), adapter.Actor{}, 91000006)
	if err != nil || none.Data == nil {
		t.Fatalf("no connection err=%v", err)
	}
	if none.Data.State.Canonical != adapter.CRMUsersNoAuthorizedConnection || none.Data.Connection != nil || none.Data.Users != nil {
		t.Fatalf("no connection=%+v", none.Data)
	}
}

func TestCRMUsersUnknownAccountAndCapability(t *testing.T) {
	if _, err := Demo("core").GetCRMUsers(context.Background(), adapter.Actor{}, 99999999); !errors.Is(err, adapter.ErrNotFound) {
		t.Fatalf("unknown account err=%v", err)
	}
	if _, err := Module("fixture").GetCRMUsers(context.Background(), adapter.Actor{}, 91000002); !errors.Is(err, adapter.ErrUnsupported) {
		t.Fatalf("module err=%v", err)
	}
}
