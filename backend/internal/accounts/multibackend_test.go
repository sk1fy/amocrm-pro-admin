package accounts

import (
	"slices"
	"testing"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
)

func TestGetAccountMergesFixtureProfiles(t *testing.T) {
	svc := New([]adapter.Backend{fixture.Demo("core"), fixture.Module("fixture")}, nil)
	card, err := svc.GetAccount(t.Context(), adapter.Actor{Value: "employee:test"}, 91000002)
	if err != nil {
		t.Fatal(err)
	}
	if card.AccountID != 91000002 || card.Origin != adapter.OriginFixture || len(card.Domains) != 1 {
		t.Fatalf("card=%+v", card)
	}
	wantIDs := []string{
		"f1a00000-0000-4000-8000-000000000003",
		"f1a00000-0000-4000-8000-000000000004",
		"f2a00000-0000-4000-8000-000000000003",
	}
	gotIDs := make([]string, 0, len(card.Connections))
	gotBackends := make([]string, 0, len(card.Connections))
	for _, conn := range card.Connections {
		if conn.Origin != adapter.OriginFixture {
			t.Fatalf("connection %s origin=%q", conn.ConnectionID, conn.Origin)
		}
		gotIDs = append(gotIDs, conn.ConnectionID)
		gotBackends = append(gotBackends, conn.Backend)
	}
	if !slices.Equal(gotIDs, wantIDs) {
		t.Fatalf("connection ids=%v want %v", gotIDs, wantIDs)
	}
	if !slices.Equal(gotBackends, []string{"core", "core", "fixture"}) {
		t.Fatalf("connection backends=%v", gotBackends)
	}
}

func TestGetAccountPartialWhenSecondBackendUnavailable(t *testing.T) {
	svc := New([]adapter.Backend{fixture.Demo("core"), fixture.Unavailable("fixture")}, nil)
	card, err := svc.GetAccount(t.Context(), adapter.Actor{Value: "employee:test"}, 91000002)
	if err != nil {
		t.Fatal(err)
	}
	if card.State != adapter.AccountPartial {
		t.Fatalf("state=%q", card.State)
	}
	if len(card.Connections) != 2 {
		t.Fatalf("connections=%+v", card.Connections)
	}
	for _, conn := range card.Connections {
		if conn.Backend != "core" || conn.Origin != adapter.OriginFixture {
			t.Fatalf("connection=%+v", conn)
		}
	}
	requireSourceStatus(t, card.Sources, "core", adapter.SourceAvailable)
	broken := requireSourceStatus(t, card.Sources, "fixture", adapter.SourceUnavailable)
	if broken.Error == nil || broken.Error.Code != adapter.ErrorCodeUnavailable {
		t.Fatalf("fixture error=%+v", broken.Error)
	}
}

func TestListAccountsPartialWhenSecondBackendUnavailable(t *testing.T) {
	svc := New([]adapter.Backend{fixture.Demo("core"), fixture.Unavailable("fixture")}, nil)
	result, err := svc.ListAccounts(t.Context(), adapter.Actor{Value: "employee:test"}, ListFilter{Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	var account *Aggregated
	for i := range result.Items {
		if result.Items[i].AccountID == 91000002 {
			account = &result.Items[i]
			break
		}
	}
	if account == nil {
		t.Fatalf("account 91000002 missing in %+v", result.Items)
	}
	if account.State != adapter.AccountPartial || len(account.Connections) != 2 {
		t.Fatalf("account=%+v", account)
	}
	for _, conn := range account.Connections {
		if conn.Backend != "core" || conn.Origin != adapter.OriginFixture {
			t.Fatalf("connection=%+v", conn)
		}
	}
	requireSourceStatus(t, result.Sources, "core", adapter.SourceAvailable)
	broken := requireSourceStatus(t, result.Sources, "fixture", adapter.SourceUnavailable)
	if broken.Error == nil || broken.Error.Code != adapter.ErrorCodeUnavailable {
		t.Fatalf("fixture error=%+v", broken.Error)
	}
}

func TestListAccountsFindsModuleOnlyAccount(t *testing.T) {
	svc := New([]adapter.Backend{fixture.Demo("core"), fixture.Module("fixture")}, nil)
	for _, query := range []string{"92000001", "fixture-module-one.amocrm.test"} {
		result, err := svc.ListAccounts(t.Context(), adapter.Actor{Value: "employee:test"}, ListFilter{Q: query, Limit: 25})
		if err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		if len(result.Items) != 1 || result.Items[0].AccountID != 92000001 {
			t.Fatalf("%s: items=%+v", query, result.Items)
		}
		item := result.Items[0]
		if item.Origin != adapter.OriginFixture || len(item.Connections) != 1 {
			t.Fatalf("%s: item=%+v", query, item)
		}
		conn := item.Connections[0]
		if conn.Backend != "fixture" || conn.ConnectionID != "f2a00000-0000-4000-8000-000000000001" {
			t.Fatalf("%s: connection=%+v", query, conn)
		}
	}
}

func requireSourceStatus(t *testing.T, sources []adapter.SourceStatus, backend, status string) adapter.SourceStatus {
	t.Helper()
	for _, source := range sources {
		if source.Backend == backend {
			if source.Status != status {
				t.Fatalf("source %s status=%q want %q", backend, source.Status, status)
			}
			return source
		}
	}
	t.Fatalf("source %s missing in %+v", backend, sources)
	return adapter.SourceStatus{}
}
