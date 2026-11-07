package accounts

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
)

// switchable fails ListAccounts while down is set.
type switchable struct {
	adapter.Backend
	down bool
}

func (s *switchable) ListAccounts(ctx context.Context, actor adapter.Actor, f adapter.AccountFilter) (adapter.Observation[adapter.Page[adapter.Account]], error) {
	if s.down {
		return adapter.Observation[adapter.Page[adapter.Account]]{}, adapter.Unavailable(s.Descriptor().Code, "backend unavailable")
	}
	return s.Backend.ListAccounts(ctx, actor, f)
}

func connectionKeys(items []Aggregated) []string {
	keys := []string{}
	for _, item := range items {
		for _, conn := range item.Connections {
			keys = append(keys, fmt.Sprintf("%s/%d/%s", conn.Backend, item.AccountID, conn.ConnectionID))
		}
	}
	return keys
}

func allConnectionKeys(t *testing.T, backends []adapter.Backend) map[string]bool {
	t.Helper()
	all := map[string]bool{}
	for _, backend := range backends {
		result, err := New([]adapter.Backend{backend}, nil).ListAccounts(t.Context(), adapter.Actor{}, ListFilter{Limit: 100})
		if err != nil || result.NextCursor != nil {
			t.Fatalf("full list of %s: next=%v err=%v", backend.Descriptor().Code, result.NextCursor, err)
		}
		for _, key := range connectionKeys(result.Items) {
			all[key] = true
		}
	}
	return all
}

func TestListAccountsDoesNotRestartExhaustedSource(t *testing.T) {
	backends := []adapter.Backend{fixture.Demo("core"), fixture.Module("fixture")}
	want := allConnectionKeys(t, backends)
	svc := New(backends, nil)
	seen := map[string]int{}
	cursor := ""
	for page := 1; ; page++ {
		if page > 50 {
			t.Fatal("pagination did not end")
		}
		result, err := svc.ListAccounts(t.Context(), adapter.Actor{}, ListFilter{Limit: 1, Cursor: cursor})
		if err != nil {
			t.Fatal(err)
		}
		for _, key := range connectionKeys(result.Items) {
			seen[key]++
			if seen[key] > 1 {
				t.Fatalf("page %d repeats %s", page, key)
			}
		}
		if result.NextCursor == nil {
			break
		}
		cursor = *result.NextCursor
	}
	if len(seen) != len(want) {
		t.Fatalf("seen %d connections, want %d", len(seen), len(want))
	}
}

func TestListAccountsKeepsPositionOfUnavailableSource(t *testing.T) {
	flaky := &switchable{Backend: fixture.Module("fixture")}
	backends := []adapter.Backend{fixture.Demo("core"), flaky}
	want := allConnectionKeys(t, []adapter.Backend{fixture.Demo("core"), fixture.Module("fixture")})
	svc := New(backends, nil)
	seen := map[string]int{}
	cursor := ""
	for page := 1; ; page++ {
		if page > 50 {
			t.Fatal("pagination did not end")
		}
		before, err := DecodeCursors(cursor)
		if err != nil {
			t.Fatal(err)
		}
		flaky.down = page == 2
		result, err := svc.ListAccounts(t.Context(), adapter.Actor{}, ListFilter{Limit: 1, Cursor: cursor})
		if err != nil {
			t.Fatal(err)
		}
		if flaky.down {
			requireSourceStatus(t, result.Sources, "fixture", adapter.SourceUnavailable)
			if result.NextCursor == nil {
				t.Fatal("unavailable source ended the list")
			}
			after, err := DecodeCursors(*result.NextCursor)
			if err != nil {
				t.Fatal(err)
			}
			if after["fixture"] != before["fixture"] {
				t.Fatalf("fixture position moved %q -> %q", before["fixture"], after["fixture"])
			}
		}
		for _, key := range connectionKeys(result.Items) {
			seen[key]++
			if seen[key] > 1 {
				t.Fatalf("page %d repeats %s", page, key)
			}
		}
		if result.NextCursor == nil {
			break
		}
		cursor = *result.NextCursor
	}
	if len(seen) != len(want) {
		t.Fatalf("seen %d connections, want %d", len(seen), len(want))
	}
}

func TestListAccountsReadsLegacyCursorWithoutRestarting(t *testing.T) {
	backends := []adapter.Backend{fixture.Demo("core"), fixture.Module("fixture")}
	svc := New(backends, nil)
	first, err := svc.ListAccounts(t.Context(), adapter.Actor{}, ListFilter{Limit: 1, Backend: "core"})
	if err != nil || first.NextCursor == nil {
		t.Fatalf("first page: %v %v", first.NextCursor, err)
	}
	// Earlier cursors omitted exhausted sources: here "fixture" is finished.
	result, err := svc.ListAccounts(t.Context(), adapter.Actor{}, ListFilter{Limit: 1, Cursor: *first.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range result.Items {
		for _, conn := range item.Connections {
			if conn.Backend == "fixture" {
				t.Fatalf("legacy cursor restarted a finished source: %+v", item)
			}
		}
	}
}

func TestScanDoesNotMergeExhaustedSourceTwice(t *testing.T) {
	now := time.Now().UTC()
	data := fixture.Data{}
	for n := 0; n < scanPageSize+50; n++ {
		data.Accounts = append(data.Accounts, adapter.Account{AccountID: int64(5000 - n), LastActivityAt: now.Add(-time.Duration(n) * time.Second), Connections: []adapter.ConnectionSummary{{ID: fmt.Sprint("big-", n), Status: adapter.MapConnectionStatus("active")}}})
	}
	big := fixture.New(fixture.Options{Code: "big", Data: data})
	svc := New([]adapter.Backend{big, fixture.Module("fixture")}, nil)
	result, err := svc.ListAccounts(t.Context(), adapter.Actor{}, ListFilter{Origin: adapter.OriginFixture, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) == 0 {
		t.Fatal("no module accounts")
	}
	for _, item := range result.Items {
		seen := map[string]bool{}
		for _, conn := range item.Connections {
			key := conn.Backend + "/" + conn.ConnectionID
			if seen[key] {
				t.Fatalf("account %d lists %s twice", item.AccountID, key)
			}
			seen[key] = true
		}
	}
}

func TestContinuationEncode(t *testing.T) {
	next := "p2"
	queried := []adapter.Backend{fixture.Demo("a"), fixture.Demo("b")}
	cases := []struct {
		name     string
		previous map[string]string
		advance  map[string]*string
		want     map[string]string
	}{
		{name: "all exhausted", previous: map[string]string{}, advance: map[string]*string{"a": nil, "b": nil}},
		{name: "nothing answered on first page", previous: map[string]string{}},
		{name: "one exhausted, one unavailable from start", previous: map[string]string{}, advance: map[string]*string{"a": nil}, want: map[string]string{"a": exhaustedCursor, "b": ""}},
		{name: "unavailable keeps position", previous: map[string]string{"a": "p1", "b": "q1"}, advance: map[string]*string{"a": &next}, want: map[string]string{"a": "p2", "b": "q1"}},
		{name: "finished stays finished", previous: map[string]string{"a": exhaustedCursor, "b": "q1"}, advance: map[string]*string{"b": &next}, want: map[string]string{"a": exhaustedCursor, "b": "p2"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := NewContinuation(tc.previous)
			pending := PendingBackends(queried, tc.previous)
			for backend, cursor := range tc.advance {
				c.Advance(backend, cursor)
			}
			raw := c.Encode(pending)
			if tc.want == nil {
				if raw != nil {
					t.Fatalf("cursor %q, want nil", *raw)
				}
				return
			}
			if raw == nil {
				t.Fatal("cursor nil")
			}
			got, err := DecodeCursors(*raw)
			if err != nil {
				t.Fatal(err)
			}
			if fmt.Sprint(got) != fmt.Sprint(tc.want) {
				t.Fatalf("cursor %v, want %v", got, tc.want)
			}
		})
	}
}
