package accounts

import (
	"context"
	"fmt"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
	"testing"
	"time"
)

type legacyVerification struct {
	adapter.Backend
	calls int
}

func (b *legacyVerification) ListAccounts(ctx context.Context, actor adapter.Actor, f adapter.AccountFilter) (adapter.Observation[adapter.Page[adapter.Account]], error) {
	b.calls++
	f.Verification = ""
	return b.Backend.ListAccounts(ctx, actor, f)
}
func TestVerificationLegacyScanIsBoundedAndContinues(t *testing.T) {
	now := time.Now().UTC()
	data := fixture.Data{}
	for n := 0; n < 1005; n++ {
		data.Accounts = append(data.Accounts, adapter.Account{AccountID: int64(2000 - n), LastActivityAt: now.Add(-time.Duration(n) * time.Second), Connections: []adapter.ConnectionSummary{{ID: fmt.Sprint(n), Status: adapter.MapConnectionStatus("active")}}})
	}
	backend := &legacyVerification{Backend: fixture.New(fixture.Options{Code: "core", Data: data})}
	s := New([]adapter.Backend{backend}, nil)
	seen := map[int64]bool{}
	cursor := ""
	for page := 0; page < 100; page++ {
		before := backend.calls
		got, err := s.ListAccounts(t.Context(), adapter.Actor{}, ListFilter{Verification: "unknown", Limit: 17, Cursor: cursor})
		if err != nil {
			t.Fatal(err)
		}
		if backend.calls-before > verificationScanPages {
			t.Fatal("unbounded scan")
		}
		for _, item := range got.Items {
			if seen[item.AccountID] {
				t.Fatalf("duplicate %d", item.AccountID)
			}
			seen[item.AccountID] = true
		}
		if got.NextCursor == nil {
			break
		}
		cursor = *got.NextCursor
	}
	if len(seen) != 1005 {
		t.Fatalf("lost rows %d", len(seen))
	}
	cursor = ""
	totalCalls := 0
	for page := 0; page < 10; page++ {
		before := backend.calls
		got, err := s.ListAccounts(t.Context(), adapter.Actor{}, ListFilter{Verification: "ok", Limit: 17, Cursor: cursor})
		if err != nil {
			t.Fatal(err)
		}
		if len(got.Items) != 0 {
			t.Fatal("unknown became green")
		}
		delta := backend.calls - before
		totalCalls += delta
		if delta > verificationScanPages {
			t.Fatal("unbounded empty scan")
		}
		if got.NextCursor == nil {
			break
		}
		cursor = *got.NextCursor
	}
	if totalCalls != 11 {
		t.Fatalf("failed scan skipped or repeated pages %d", totalCalls)
	}
}
func TestVerificationCombinesBackendFactsWithoutBreakingNativeCursor(t *testing.T) {
	now := time.Now().UTC()
	verified := &adapter.Verification{Classification: "verified_ok", Freshness: "fresh", ObservedAt: &now}
	account := func(id int64, at time.Time, backend string, check *adapter.Verification) adapter.Account {
		return adapter.Account{AccountID: id, LastActivityAt: at, Connections: []adapter.ConnectionSummary{{ID: fmt.Sprintf("%s-%d", backend, id), UpdatedAt: at, Status: adapter.MapConnectionStatus("active"), Authorization: adapter.MapAuthState("valid"), AuthorizationCheck: check}}}
	}
	a := fixture.New(fixture.Options{Code: "a", Data: fixture.Data{Accounts: []adapter.Account{account(1, now, "a", verified), account(2, now.Add(-time.Minute), "a", verified)}}})
	b := fixture.New(fixture.Options{Code: "b", Data: fixture.Data{Accounts: []adapter.Account{account(2, now.Add(time.Minute), "b", &adapter.Verification{Classification: "auth_error", Freshness: "fresh", ObservedAt: &now}), account(1, now, "b", verified)}}})
	s := New([]adapter.Backend{a, b}, nil)
	cursor := ""
	seen := map[int64]bool{}
	for n := 0; n < 10; n++ {
		got, err := s.ListAccounts(t.Context(), adapter.Actor{}, ListFilter{Verification: "ok", Limit: 1, Cursor: cursor})
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range got.Items {
			if seen[item.AccountID] {
				t.Fatal("duplicate account")
			}
			seen[item.AccountID] = true
			if len(item.Connections) != 2 {
				t.Fatalf("missing backend facts %+v", item)
			}
			if item.AccountID == 2 && item.State != adapter.AccountNeedsAction {
				t.Fatal("lost auth error")
			}
		}
		if got.NextCursor == nil {
			break
		}
		cursor = *got.NextCursor
	}
	if len(seen) != 2 {
		t.Fatalf("missing account %v", seen)
	}
}

func TestVerificationOwnerRespectsPushedIntegrationScope(t *testing.T) {
	now := time.Now().UTC()
	v := &adapter.Verification{Classification: "verified_ok", Freshness: "fresh", ObservedAt: &now}
	makeBackend := func(code, integration string) *fixture.Adapter {
		return fixture.New(fixture.Options{Code: code, Data: fixture.Data{Accounts: []adapter.Account{{AccountID: 1, LastActivityAt: now, Connections: []adapter.ConnectionSummary{{ID: code, IntegrationID: integration, AccountDomain: "scope.amocrm.test", AuthorizationCheck: v, Status: adapter.MapConnectionStatus("active")}}}}}})
	}
	s := New([]adapter.Backend{makeBackend("a", "other"), makeBackend("z", "target")}, nil)
	result, err := s.ListAccounts(t.Context(), adapter.Actor{}, ListFilter{Verification: "ok", IntegrationID: "target", Limit: 1})
	if err != nil || len(result.Items) != 1 {
		t.Fatalf("lost scoped account: %+v %v", result, err)
	}
}
