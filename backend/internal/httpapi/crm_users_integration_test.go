package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
	"github.com/sk1fy/amocrm-pro-admin/internal/catalog"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

type crmUsersTestResponse struct {
	Items []struct {
		Source     string            `json:"source"`
		ObservedAt time.Time         `json:"observed_at"`
		Freshness  string            `json:"freshness"`
		Error      *adapter.ObsError `json:"error"`
		Data       *struct {
			State      string `json:"state"`
			Connection *struct {
				ID              string `json:"id"`
				IntegrationCode string `json:"integration_code"`
			} `json:"connection"`
			FreshUntil        *time.Time `json:"fresh_until"`
			RetryAfterSeconds *int64     `json:"retry_after_seconds"`
			Users             []struct {
				ID       int64  `json:"id"`
				Name     string `json:"name"`
				IsActive bool   `json:"is_active"`
				IsAdmin  bool   `json:"is_admin"`
			} `json:"users"`
			Total *int `json:"total"`
		} `json:"data"`
	} `json:"items"`
	Sources []adapter.SourceStatus `json:"sources"`
}

func crmUsersSession(t *testing.T, registry *catalog.Registry, role string) (http.Handler, string) {
	t.Helper()
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	router := testRouterWithRegistry(t, pool, 10, registry)
	store := employees.NewStore(pool, 2*time.Second)
	employee := createEmployee(t, t.Context(), store, "crm-users-"+role+"@example.invalid", "Employee", role)
	return router, sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(employee.Email, testPassword), ""))
}

func TestAccountCRMUsers(t *testing.T) {
	router, cookie := crmUsersSession(t, catalog.FromBackends(fixture.Demo("core"), fixture.Module("fixture")), rbac.RoleViewer)

	found := doJSON(t, router, http.MethodGet, "/api/v1/accounts/91000001/crm-users", "", cookie)
	if found.Code != http.StatusOK {
		t.Fatalf("crm users=%d %s", found.Code, found.Body.String())
	}
	if got := found.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("cache-control=%q", got)
	}
	assertNoSecretJSONKeys(t, found.Body.Bytes())
	for _, field := range []string{"email", "phone", "rights", "group"} {
		if strings.Contains(found.Body.String(), `"`+field) {
			t.Fatalf("contact or rights field %q leaked: %s", field, found.Body.String())
		}
	}
	var body crmUsersTestResponse
	decodeBody(t, found, &body)
	if len(body.Items) != 1 || len(body.Sources) != 1 || body.Sources[0].Backend != "core" || body.Sources[0].Status != adapter.SourceAvailable {
		t.Fatalf("module backend without capability must be skipped: %s", found.Body.String())
	}
	item := body.Items[0]
	if item.Source != "core" || item.Freshness != adapter.FreshnessFresh || item.Data == nil || item.Data.State != adapter.CRMUsersOK {
		t.Fatalf("item=%s", found.Body.String())
	}
	data := item.Data
	if data.Total == nil || *data.Total != 3 || len(data.Users) != 3 || data.FreshUntil == nil {
		t.Fatalf("data=%s", found.Body.String())
	}
	if first := data.Users[0]; first.ID != 501 || first.Name != "Fixture User A" || !first.IsActive || !first.IsAdmin {
		t.Fatalf("first user=%+v", first)
	}
	if data.Connection == nil || data.Connection.ID != "f1a00000-0000-4000-8000-000000000001" {
		t.Fatalf("connection=%s", found.Body.String())
	}

	limited := doJSON(t, router, http.MethodGet, "/api/v1/accounts/91000002/crm-users", "", cookie)
	var limitedBody crmUsersTestResponse
	decodeBody(t, limited, &limitedBody)
	if len(limitedBody.Items) != 1 || limitedBody.Items[0].Data == nil {
		t.Fatalf("rate limited=%s", limited.Body.String())
	}
	if d := limitedBody.Items[0].Data; d.State != adapter.CRMUsersRateLimited || d.Users != nil || d.Total != nil ||
		d.RetryAfterSeconds == nil || *d.RetryAfterSeconds != 30 {
		t.Fatalf("rate limited data=%s", limited.Body.String())
	}
	if !strings.Contains(limited.Body.String(), `"users":null`) {
		t.Fatalf("unknown list must be null, not empty: %s", limited.Body.String())
	}

	unknown := doJSON(t, router, http.MethodGet, "/api/v1/accounts/99999999/crm-users", "", cookie)
	var unknownBody crmUsersTestResponse
	decodeBody(t, unknown, &unknownBody)
	if unknown.Code != http.StatusOK || unknownBody.Items == nil || len(unknownBody.Items) != 0 ||
		len(unknownBody.Sources) != 1 || unknownBody.Sources[0].Status != adapter.SourceAvailable {
		t.Fatalf("unknown account=%d %s", unknown.Code, unknown.Body.String())
	}

	invalid := doJSON(t, router, http.MethodGet, "/api/v1/accounts/not-a-number/crm-users", "", cookie)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid account id=%d", invalid.Code)
	}
}

func TestAccountCRMUsersWithoutCapableBackend(t *testing.T) {
	router, cookie := crmUsersSession(t, catalog.FromBackends(fixture.Module("fixture")), rbac.RoleViewer)
	response := doJSON(t, router, http.MethodGet, "/api/v1/accounts/91000002/crm-users", "", cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("crm users=%d %s", response.Code, response.Body.String())
	}
	if strings.TrimSpace(response.Body.String()) != `{"items":[],"sources":[]}` {
		t.Fatalf("no capable backend must give empty items and sources: %s", response.Body.String())
	}
}

func TestAccountCRMUsersRequiresSession(t *testing.T) {
	router, _ := crmUsersSession(t, catalog.FromBackends(fixture.Demo("core")), rbac.RoleViewer)
	response := doJSON(t, router, http.MethodGet, "/api/v1/accounts/91000001/crm-users", "", "")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous=%d", response.Code)
	}
}

type failingCRMUsersAdapter struct {
	*fixture.Adapter
	err error
}

func (f failingCRMUsersAdapter) GetCRMUsers(ctx context.Context, _ adapter.Actor, _ int64) (adapter.Observation[adapter.CRMUsers], error) {
	if f.err != nil {
		return adapter.Observation[adapter.CRMUsers]{}, f.err
	}
	<-ctx.Done()
	return adapter.Observation[adapter.CRMUsers]{}, adapter.Timeout("core", "core request timed out")
}

func (failingCRMUsersAdapter) CRMUsersTimeout() time.Duration { return 20 * time.Millisecond }

func TestAccountCRMUsersSourceFailures(t *testing.T) {
	cases := map[string]struct {
		err  error
		code string
	}{
		"unavailable": {err: adapter.Unavailable("core", "core unavailable"), code: adapter.ErrorCodeUnavailable},
		"timeout":     {code: adapter.ErrorCodeTimeout},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			backend := failingCRMUsersAdapter{Adapter: fixture.Demo("core"), err: tc.err}
			router, cookie := crmUsersSession(t, catalog.FromBackends(backend), rbac.RoleViewer)
			response := doJSON(t, router, http.MethodGet, "/api/v1/accounts/91000001/crm-users", "", cookie)
			if response.Code != http.StatusOK {
				t.Fatalf("crm users=%d %s", response.Code, response.Body.String())
			}
			assertNoSecretJSONKeys(t, response.Body.Bytes())
			var body crmUsersTestResponse
			decodeBody(t, response, &body)
			if body.Items == nil || len(body.Items) != 0 || strings.Contains(response.Body.String(), `"users"`) {
				t.Fatalf("failed source must not carry a list: %s", response.Body.String())
			}
			if len(body.Sources) != 1 || body.Sources[0].Status != adapter.SourceUnavailable ||
				body.Sources[0].Error == nil || body.Sources[0].Error.Code != tc.code {
				t.Fatalf("sources=%s", response.Body.String())
			}
		})
	}
}
