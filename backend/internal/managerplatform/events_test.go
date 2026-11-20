package managerplatform

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/api"
	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

func eventEndpoint(t *testing.T, route apicontract.Route) AccountEndpoint {
	t.Helper()
	for _, endpoint := range AccountEndpoints() {
		if endpoint.Route == route {
			return endpoint
		}
	}
	t.Fatal("event endpoint missing")
	return AccountEndpoint{}
}

func TestManagerEventsQueriesAndGrants(t *testing.T) {
	contract, err := api.LoadPlatformContract()
	if err != nil {
		t.Fatal(err)
	}
	client := Client{contract: contract}
	for _, test := range []struct {
		route apicontract.Route
		grant auth.ManagerGrant
	}{{apicontract.ManagerFeed, auth.GrantFeedRead}, {apicontract.ManagerAccountHistory, auth.GrantClientsRead}} {
		endpoint := eventEndpoint(t, test.route)
		if endpoint.Mutates() || endpoint.Grant() != test.grant {
			t.Fatal("wrong event route grant")
		}
		operation := client.accountContract(endpoint)
		for _, query := range []string{"limit=100&kind=installed&kind=uninstalled&from=2026-01-01&to=2026-02-01", "cursor=opaque&product_id=" + uuid.NewString()} {
			if _, err := accountQuery(operation, query); err != nil {
				t.Fatalf("valid query %s: %v", query, err)
			}
		}
		for _, query := range []string{"limit=101", "kind=internal", "kind=installed&kind=", "cursor=x&cursor=y", "from=not-a-date", "product_id=" + uuid.Nil.String(), "other=value"} {
			if _, err := accountQuery(operation, query); err == nil {
				t.Fatalf("accepted invalid query %s", query)
			}
		}
		_, err = accountQuery(operation, "account_id="+uuid.NewString())
		if (err == nil) != (test.route == apicontract.ManagerFeed) {
			t.Fatal("account filter must be feed-only")
		}
	}
}

func eventPageJSON(account, product uuid.UUID) string {
	return `{"items":[{"id":"` + uuid.NewString() + `","kind":"installed","occurred_at":"2026-11-17T10:00:00Z","recorded_at":"2026-11-17T10:01:00Z","account_id":"` + account.String() + `","product_id":"` + product.String() + `","summary":"Виджет установлен","related_refs":[{"kind":"account","id":"` + account.String() + `"},{"kind":"product","id":"` + product.String() + `"}]}],"next_cursor":null,"snapshot_at":"2026-11-17T11:00:00Z","query_hash":"` + strings.Repeat("a", 64) + `"}`
}

func TestManagerEventResponseConsistency(t *testing.T) {
	account, product := uuid.New(), uuid.New()
	valid := eventPageJSON(account, product)
	subdomain, displayName := "fixture-17", "Reviewed product"
	for _, test := range []struct {
		name   string
		edit   func(*wire.EventList)
		query  url.Values
		target uuid.UUID
		want   bool
	}{
		{"same history account", nil, nil, account, true},
		{"same feed filters", nil, url.Values{"account_id": {account.String()}, "product_id": {product.String()}, "kind": {"installed", "uninstalled"}}, uuid.Nil, true},
		{"different history account", nil, nil, uuid.New(), false},
		{"different feed product", nil, url.Values{"product_id": {uuid.NewString()}}, uuid.Nil, false},
		{"different kind", nil, url.Values{"kind": {"uninstalled"}}, uuid.Nil, false},
		{"duplicate event", func(p *wire.EventList) { p.Items = append(p.Items, p.Items[0]) }, nil, account, false},
		{"missing snapshot", func(p *wire.EventList) { p.SnapshotAt = time.Time{} }, nil, account, false},
		{"bad hash", func(p *wire.EventList) { p.QueryHash = "wrong" }, nil, account, false},
		{"missing cursor", func(p *wire.EventList) { p.NextCursor = nil }, nil, account, false},
		{"empty cursor", func(p *wire.EventList) { p.NextCursor.Set("") }, nil, account, false},
		{"repeated cursor", func(p *wire.EventList) { p.NextCursor.Set("same") }, url.Values{"cursor": {"same"}}, account, false},
		{"wrong account reference", func(p *wire.EventList) { p.Items[0].RelatedRefs[0].Id = uuid.New() }, nil, account, false},
		{"wrong product reference", func(p *wire.EventList) { p.Items[0].RelatedRefs[1].Id = uuid.New() }, nil, account, false},
		{"account label without destination", func(p *wire.EventList) {
			p.Items[0].AccountSubdomain = &subdomain
			p.Items[0].RelatedRefs = p.Items[0].RelatedRefs[1:]
		}, nil, account, false},
		{"product label without destination", func(p *wire.EventList) {
			p.Items[0].ProductDisplayName = &displayName
			p.Items[0].RelatedRefs = p.Items[0].RelatedRefs[:1]
		}, nil, account, false},
		{"missing items", func(p *wire.EventList) { p.Items = nil }, nil, account, false},
		{"confirmed empty", func(p *wire.EventList) { p.Items = []wire.Event{} }, nil, account, true},
		{"page over requested limit", func(p *wire.EventList) { other := p.Items[0]; other.Id = uuid.New(); p.Items = append(p.Items, other) }, url.Values{"limit": {"1"}}, account, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			var page wire.EventList
			if err := json.Unmarshal([]byte(valid), &page); err != nil {
				t.Fatal(err)
			}
			if test.edit != nil {
				test.edit(&page)
			}
			if got := validManagerEvents(&page, test.target, test.query); got != test.want {
				t.Fatalf("valid=%t want=%t", got, test.want)
			}
		})
	}
}

func TestManagerEventsNamedTransport(t *testing.T) {
	account, product := uuid.New(), uuid.New()
	principal := auth.Principal{Audience: auth.Managers, SessionID: uuid.New(), EmployeeID: uuid.New()}
	principal.Account.ManagerGrantsVersion = 1
	principal.Account.ManagerGrants = []auth.ManagerGrant{auth.GrantClientsRead, auth.GrantFeedRead}
	var path, rawQuery string
	status := http.StatusOK
	body := eventPageJSON(account, product)
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.Header.Get("X-Platform-Actor") == "" {
			t.Error("missing readonly actor request")
		}
		path, rawQuery = r.URL.Path, r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	defer peer.Close()
	generated, err := wire.NewClientWithResponses(peer.URL)
	if err != nil {
		t.Fatal(err)
	}
	contract, err := api.LoadPlatformContract()
	if err != nil {
		t.Fatal(err)
	}
	client := Client{wire: generated, contract: contract, timeout: time.Second}
	for _, route := range []apicontract.Route{apicontract.ManagerFeed, apicontract.ManagerAccountHistory} {
		endpoint := eventEndpoint(t, route)
		query := url.Values{"kind": {"installed", "uninstalled"}, "limit": {"10"}}
		target := uuid.Nil
		if route == apicontract.ManagerAccountHistory {
			target = account
		}
		result, err := client.clientAccountRequest(context.Background(), principal, client.accountContract(endpoint), endpoint, target, query, nil, intent{})
		if err != nil {
			t.Fatal(err)
		}
		wantPath := strings.Replace(route.Path, apicontract.ManagerPrefix, "/internal/platform/v1/managers", 1)
		wantPath = strings.ReplaceAll(wantPath, "{id}", account.String())
		if path != wantPath || rawQuery != query.Encode() || result.Status != 200 {
			t.Fatal("named transport lost route, query or response")
		}
	}
	endpoint := eventEndpoint(t, apicontract.ManagerFeed)
	body = strings.Replace(body, `"summary":`, `"account_subdomain":"fixture-17","product_display_name":"Reviewed product","summary":`, 1)
	result, err := client.clientAccountRequest(context.Background(), principal, client.accountContract(endpoint), endpoint, uuid.Nil, nil, nil, intent{})
	if err != nil {
		t.Fatal(err)
	}
	event := result.Data.(*wire.EventList).Items[0]
	if event.AccountSubdomain == nil || *event.AccountSubdomain != "fixture-17" ||
		event.ProductDisplayName == nil || *event.ProductDisplayName != "Reviewed product" {
		t.Fatal("event response dropped authorized labels")
	}
	feedOnly := principal
	feedOnly.Account.ManagerGrants = []auth.ManagerGrant{auth.GrantFeedRead}
	if _, err = client.clientAccountRequest(context.Background(), feedOnly, client.accountContract(endpoint), endpoint, uuid.Nil, nil, nil, intent{}); err != ErrUnavailable {
		t.Fatalf("event labels accepted without client access: %v", err)
	}
	for _, invalid := range []string{
		`{"items":[],"next_cursor":null,"snapshot_at":"2026-11-17T11:00:00Z","query_hash":"` + strings.Repeat("a", 64) + `","secret":"unsafe"}`,
		strings.ReplaceAll(body, `"kind":"installed"`, `"kind":"unexpected"`),
		strings.ReplaceAll(body, `"account_subdomain":"fixture-17"`, `"account_subdomain":"fixture-17.amocrm.test"`),
		strings.ReplaceAll(body, account.String(), uuid.Nil.String()),
		`{"items":[],"next_cursor":null,"snapshot_at":"2026-11-17T11:00:00Z","query_hash":"bad"}`,
	} {
		body = invalid
		if _, err := client.clientAccountRequest(context.Background(), principal, client.accountContract(endpoint), endpoint, uuid.Nil, nil, nil, intent{}); err != ErrUnavailable {
			t.Fatalf("malformed owner response accepted: %v", err)
		}
	}
	status = http.StatusServiceUnavailable
	body = "unavailable"
	if _, err := client.clientAccountRequest(context.Background(), principal, client.accountContract(endpoint), endpoint, uuid.Nil, nil, nil, intent{}); err != ErrUnavailable {
		t.Fatalf("source failure became empty feed: %v", err)
	}

}
