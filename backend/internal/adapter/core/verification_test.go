package core

import (
	"encoding/json"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"testing"
	"time"
)

func TestVerificationCompatibleAndSafe(t *testing.T) {
	var old accountListItem
	if err := json.Unmarshal([]byte(`{"account_id":1,"installations":[{"id":"fixture","status":"active"}]}`), &old); err != nil {
		t.Fatal(err)
	}
	if mapAccountListItem(old).Connections[0].AuthorizationCheck != nil {
		t.Fatal("old backend invented verification")
	}
	now := time.Now()
	raw := &adapter.Verification{Classification: "future-value", Freshness: "fresh", ObservedAt: &now, Error: &adapter.ObsError{Message: "unsafe upstream body"}}
	got := adapter.NormalizeVerification(raw)
	if got.Classification != "unknown" || got.Raw != "future-value" || got.Freshness != "unknown" || got.Error.Message == raw.Error.Message {
		t.Fatalf("%+v", got)
	}
}
