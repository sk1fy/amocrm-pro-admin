package fixture

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

func TestSubscriptionPresent(t *testing.T) {
	fx := Demo("core")
	obs, err := fx.GetSubscription(context.Background(), adapter.Actor{}, 91000001)
	if err != nil || obs.Data == nil {
		t.Fatalf("subscription err=%v", err)
	}
	if obs.Freshness != adapter.FreshnessFresh || obs.Source != "core" {
		t.Fatalf("observation=%+v", obs)
	}
	data := *obs.Data
	if data.Plan != "Профи" || data.State.Canonical != adapter.SubscriptionActive || data.State.Raw != "" {
		t.Fatalf("data=%+v", data)
	}
	if data.ExpiresAt == nil {
		t.Fatal("expires_at must be set")
	}
	if !slices.Equal(data.Capabilities, []string{"lead-status", "activity"}) {
		t.Fatalf("capabilities=%v", data.Capabilities)
	}
}

func TestSubscriptionUnknownStateKeepsRaw(t *testing.T) {
	fx := Demo("core")
	obs, err := fx.GetSubscription(context.Background(), adapter.Actor{}, 91000002)
	if err != nil || obs.Data == nil {
		t.Fatalf("subscription err=%v", err)
	}
	if obs.Data.State.Canonical != adapter.StateUnknown || obs.Data.State.Raw != "grace_period" {
		t.Fatalf("state=%+v", obs.Data.State)
	}
	if obs.Data.ExpiresAt != nil {
		t.Fatalf("expires_at=%v", obs.Data.ExpiresAt)
	}
}

func TestSubscriptionEmptyCapabilitiesStayEmpty(t *testing.T) {
	fx := Demo("core")
	obs, err := fx.GetSubscription(context.Background(), adapter.Actor{}, 91000005)
	if err != nil || obs.Data == nil {
		t.Fatalf("subscription err=%v", err)
	}
	if obs.Data.State.Canonical != adapter.SubscriptionExpired {
		t.Fatalf("state=%+v", obs.Data.State)
	}
	if obs.Data.Capabilities == nil || len(obs.Data.Capabilities) != 0 {
		t.Fatalf("capabilities=%v", obs.Data.Capabilities)
	}
}

func TestSubscriptionMissingFactIsNotFound(t *testing.T) {
	fx := Demo("core")
	_, err := fx.GetSubscription(context.Background(), adapter.Actor{}, 91000004)
	if !errors.Is(err, adapter.ErrNotFound) {
		t.Fatalf("err=%v", err)
	}
	if message := adapter.SafeMessage(err); message != "subscription not found" {
		t.Fatalf("message=%q", message)
	}
}

func TestSubscriptionUnknownAccountIsNotFound(t *testing.T) {
	fx := Demo("core")
	_, err := fx.GetSubscription(context.Background(), adapter.Actor{}, 99999999)
	if !errors.Is(err, adapter.ErrNotFound) {
		t.Fatalf("err=%v", err)
	}
	if message := adapter.SafeMessage(err); message != "account not found" {
		t.Fatalf("message=%q", message)
	}
}

func TestSubscriptionMapInitializedWithoutData(t *testing.T) {
	fx := New(Options{Code: "core", Data: Data{Accounts: []adapter.Account{{AccountID: 1}}}})
	_, err := fx.GetSubscription(context.Background(), adapter.Actor{}, 1)
	if !errors.Is(err, adapter.ErrNotFound) {
		t.Fatalf("err=%v", err)
	}
}

func TestSubscriptionCapabilityNotDeclared(t *testing.T) {
	fx := Module("fixture")
	_, err := fx.GetSubscription(context.Background(), adapter.Actor{}, 91000002)
	if !errors.Is(err, adapter.ErrUnsupported) {
		t.Fatalf("err=%v", err)
	}
	if code := adapter.ObsErrorFrom(err).Code; code != adapter.ErrorCodeUnsupported {
		t.Fatalf("code=%q", code)
	}
}
