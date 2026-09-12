package accounts

import (
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
)

func TestAggregateTwoWidgetsNeedsAction(t *testing.T) {
	now := time.Date(2026, 9, 12, 10, 0, 0, 0, time.UTC)
	account := adapter.Account{
		AccountID:      91000002,
		Domains:        []string{"fixture-two.amocrm.test"},
		Origin:         adapter.OriginFixture,
		LastActivityAt: now,
		Connections: []adapter.ConnectionSummary{
			{
				ID: "f1a00000-0000-4000-8000-000000000003", IntegrationCode: "fixture-widget-a",
				AccountID: 91000002, Status: adapter.State{Canonical: adapter.StatusReauthRequired},
				WebhookStatus: adapter.State{Canonical: adapter.StatusError}, Origin: adapter.OriginFixture,
			},
			{
				ID: "f1a00000-0000-4000-8000-000000000004", IntegrationCode: "fixture-widget-b",
				AccountID: 91000002, Status: adapter.State{Canonical: adapter.StatusActive},
				WebhookStatus: adapter.State{Canonical: adapter.StatusActive}, Origin: adapter.OriginFixture,
			},
		},
	}
	got := Aggregate(account, "core", false)
	if got.State != adapter.AccountNeedsAction {
		t.Fatalf("state=%s", got.State)
	}
	if len(got.Connections) != 2 {
		t.Fatalf("connections=%d", len(got.Connections))
	}
	states := map[string]string{}
	for _, conn := range got.Connections {
		states[conn.IntegrationCode] = conn.State.Canonical
	}
	if states["fixture-widget-a"] != adapter.StatusReauthRequired || states["fixture-widget-b"] != adapter.StatusActive {
		t.Fatalf("states=%v", states)
	}
	if got.Origin != adapter.OriginFixture {
		t.Fatalf("origin=%s", got.Origin)
	}
	assertContains(t, got.Problems, adapter.ProblemReauthRequired, adapter.ProblemWebhookError)
}

func TestAggregatePartialWhenSourceUnavailable(t *testing.T) {
	account := adapter.Account{
		AccountID: 1,
		Domains:   []string{"fixture-one.amocrm.test"},
		Origin:    adapter.OriginFixture,
		Connections: []adapter.ConnectionSummary{
			{ID: "a", IntegrationCode: "w", Status: adapter.State{Canonical: adapter.StatusActive}, Origin: adapter.OriginFixture},
		},
	}
	got := Aggregate(account, "fixture", true)
	if got.State != adapter.AccountPartial {
		t.Fatalf("state=%s", got.State)
	}
	assertContains(t, got.Problems, adapter.ProblemSourceUnavailable)
	if len(got.Connections) != 1 {
		t.Fatal("connections must still be listed")
	}
}

func TestServicePartialAvailability(t *testing.T) {
	failing := fixture.Unavailable("core")
	working := fixture.New(fixture.Options{
		Code: "fixture",
		Data: fixture.Data{Accounts: []adapter.Account{{
			AccountID: 91000002,
			Domains:   []string{"fixture-two.amocrm.test"},
			Origin:    adapter.OriginFixture,
			Connections: []adapter.ConnectionSummary{
				{ID: "a", IntegrationCode: "fixture-widget-a", Status: adapter.State{Canonical: adapter.StatusReauthRequired}, Origin: adapter.OriginFixture},
				{ID: "b", IntegrationCode: "fixture-widget-b", Status: adapter.State{Canonical: adapter.StatusActive}, Origin: adapter.OriginFixture},
			},
		}}},
	})
	svc := New([]adapter.Backend{failing, working}, nil)
	got, err := svc.ListAccounts(t.Context(), adapter.Actor{Value: "employee:test"}, ListFilter{Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 1 || got.Items[0].AccountID != 91000002 {
		t.Fatalf("items=%+v", got.Items)
	}
	if got.Items[0].State != adapter.AccountPartial {
		t.Fatalf("state=%s", got.Items[0].State)
	}
	byBackend := map[string]string{}
	for _, source := range got.Sources {
		byBackend[source.Backend] = source.Status
	}
	if byBackend["core"] != adapter.SourceUnavailable || byBackend["fixture"] != adapter.SourceAvailable {
		t.Fatalf("sources=%v", byBackend)
	}
	if got.Sources[0].Error == nil || got.Sources[0].Error.Code != adapter.ErrorCodeUnavailable {
		t.Fatalf("core error=%+v", got.Sources[0].Error)
	}
}

func TestServiceAllAdaptersUnavailableStill200Shape(t *testing.T) {
	svc := New([]adapter.Backend{fixture.Unavailable("core")}, nil)
	got, err := svc.ListAccounts(t.Context(), adapter.Actor{Value: "employee:test"}, ListFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 0 {
		t.Fatalf("items=%d", len(got.Items))
	}
	if len(got.Sources) != 1 || got.Sources[0].Status != adapter.SourceUnavailable {
		t.Fatalf("sources=%+v", got.Sources)
	}
}

func TestServicePagination(t *testing.T) {
	accounts := make([]adapter.Account, 0, 30)
	for i := 1; i <= 30; i++ {
		accounts = append(accounts, adapter.Account{
			AccountID:      int64(i),
			Domains:        []string{"fixture.amocrm.test"},
			Origin:         adapter.OriginFixture,
			LastActivityAt: time.Unix(int64(i), 0).UTC(),
			Connections: []adapter.ConnectionSummary{
				{ID: formatInt(i), Status: adapter.State{Canonical: adapter.StatusActive}, Origin: adapter.OriginFixture},
			},
		})
	}
	svc := New([]adapter.Backend{fixture.New(fixture.Options{Code: "core", Data: fixture.Data{Accounts: accounts}})}, nil)
	first, err := svc.ListAccounts(t.Context(), adapter.Actor{Value: "employee:test"}, ListFilter{Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 25 || first.NextCursor == nil {
		t.Fatalf("first page items=%d cursor=%v", len(first.Items), first.NextCursor)
	}
	second, err := svc.ListAccounts(t.Context(), adapter.Actor{Value: "employee:test"}, ListFilter{Limit: 25, Cursor: *first.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 5 {
		t.Fatalf("second page items=%d", len(second.Items))
	}
}

func assertContains(t *testing.T, items []string, required ...string) {
	t.Helper()
	seen := map[string]bool{}
	for _, item := range items {
		seen[item] = true
	}
	for _, value := range required {
		if !seen[value] {
			t.Fatalf("missing %s in %v", value, items)
		}
	}
}

func formatInt(i int) string {
	return time.Unix(int64(i), 0).UTC().Format("20060102150405")
}
