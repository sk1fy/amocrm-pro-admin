package httpapi

import (
	"context"
	"net/http"
	"slices"
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

func TestStage4AccountSubscription(t *testing.T) {
	type subscriptionItemData struct {
		Plan         string     `json:"plan"`
		State        string     `json:"state"`
		Raw          string     `json:"raw"`
		ExpiresAt    *time.Time `json:"expires_at"`
		Capabilities []string   `json:"capabilities"`
	}
	type subscriptionObservationItem struct {
		Source     string                `json:"source"`
		ObservedAt time.Time             `json:"observed_at"`
		Freshness  string                `json:"freshness"`
		Error      *adapter.ObsError     `json:"error"`
		Data       *subscriptionItemData `json:"data"`
	}
	type subscriptionResponse struct {
		Items   []subscriptionObservationItem `json:"items"`
		Sources []adapter.SourceStatus        `json:"sources"`
	}

	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	router := testRouterWithRegistry(t, pool, 10, catalog.FromBackends(fixture.Demo("core"), fixture.Module("fixture")))
	ctx := t.Context()
	store := employees.NewStore(pool, 2*time.Second)
	admin := createEmployee(t, ctx, store, "stage4-admin@example.invalid", "Admin", rbac.RoleAdmin)
	adminCookie := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(admin.Email, testPassword), ""))

	found := doJSON(t, router, http.MethodGet, "/api/v1/accounts/91000001/subscription", "", adminCookie)
	if found.Code != http.StatusOK {
		t.Fatalf("subscription=%d %s", found.Code, found.Body.String())
	}
	assertNoSecretJSONKeys(t, found.Body.Bytes())
	var body subscriptionResponse
	decodeBody(t, found, &body)
	if len(body.Items) != 1 {
		t.Fatalf("items=%s", found.Body.String())
	}
	item := body.Items[0]
	if item.Source != "core" || item.Freshness != adapter.FreshnessFresh || item.ObservedAt.IsZero() || item.Error != nil {
		t.Fatalf("item=%+v", item)
	}
	if item.Data == nil || item.Data.Plan != "Профи" || item.Data.State != adapter.SubscriptionActive || item.Data.Raw != "" {
		t.Fatalf("data=%+v", item.Data)
	}
	if item.Data.ExpiresAt == nil {
		t.Fatalf("expires_at must be set: %s", found.Body.String())
	}
	if !slices.Equal(item.Data.Capabilities, []string{"lead-status", "activity"}) {
		t.Fatalf("capabilities=%v", item.Data.Capabilities)
	}
	if len(body.Sources) != 1 || body.Sources[0].Backend != "core" || body.Sources[0].Status != adapter.SourceAvailable {
		t.Fatalf("sources=%s", found.Body.String())
	}
	for _, source := range body.Sources {
		if source.Backend == "fixture" {
			t.Fatalf("module backend must be filtered out: %+v", source)
		}
	}

	missing := doJSON(t, router, http.MethodGet, "/api/v1/accounts/91000004/subscription", "", adminCookie)
	if missing.Code != http.StatusOK {
		t.Fatalf("missing=%d %s", missing.Code, missing.Body.String())
	}
	assertNoSecretJSONKeys(t, missing.Body.Bytes())
	var missingBody subscriptionResponse
	decodeBody(t, missing, &missingBody)
	if missingBody.Items == nil || len(missingBody.Items) != 0 {
		t.Fatalf("items must be an empty array: %s", missing.Body.String())
	}
	if len(missingBody.Sources) != 1 || missingBody.Sources[0].Backend != "core" || missingBody.Sources[0].Status != adapter.SourceAvailable {
		t.Fatalf("sources=%s", missing.Body.String())
	}

	moduleOnly := testRouterWithRegistry(t, pool, 10, catalog.FromBackends(fixture.Module("fixture")))
	none := doJSON(t, moduleOnly, http.MethodGet, "/api/v1/accounts/91000002/subscription", "", adminCookie)
	if none.Code != http.StatusOK {
		t.Fatalf("none=%d %s", none.Code, none.Body.String())
	}
	assertNoSecretJSONKeys(t, none.Body.Bytes())
	var noneBody subscriptionResponse
	decodeBody(t, none, &noneBody)
	if noneBody.Items == nil || len(noneBody.Items) != 0 {
		t.Fatalf("items must be an empty array: %s", none.Body.String())
	}
	if noneBody.Sources == nil || len(noneBody.Sources) != 0 {
		t.Fatalf("sources must be an empty array: %s", none.Body.String())
	}
}

type failingSubscriptionAdapter struct {
	*fixture.Adapter
}

func (failingSubscriptionAdapter) GetSubscription(context.Context, adapter.Actor, int64) (adapter.Observation[adapter.Subscription], error) {
	return adapter.Observation[adapter.Subscription]{}, adapter.Unavailable("core", "subscription backend unavailable")
}

func TestStage4AccountSubscriptionSourceUnavailable(t *testing.T) {
	type sourceError struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	type sourceStatus struct {
		Backend string       `json:"backend"`
		Status  string       `json:"status"`
		Error   *sourceError `json:"error"`
	}
	type subscriptionResponse struct {
		Items   []map[string]any `json:"items"`
		Sources []sourceStatus   `json:"sources"`
	}

	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	backend := failingSubscriptionAdapter{Adapter: fixture.Demo("core")}
	router := testRouterWithRegistry(t, pool, 10, catalog.FromBackends(backend))
	ctx := t.Context()
	store := employees.NewStore(pool, 2*time.Second)
	admin := createEmployee(t, ctx, store, "stage4-degraded@example.invalid", "Admin", rbac.RoleAdmin)
	adminCookie := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(admin.Email, testPassword), ""))

	response := doJSON(t, router, http.MethodGet, "/api/v1/accounts/91000001/subscription", "", adminCookie)
	if response.Code != http.StatusOK {
		t.Fatalf("subscription=%d %s", response.Code, response.Body.String())
	}
	assertNoSecretJSONKeys(t, response.Body.Bytes())
	if strings.Contains(response.Body.String(), `"data"`) {
		t.Fatalf("failed source must not carry data: %s", response.Body.String())
	}
	var body subscriptionResponse
	decodeBody(t, response, &body)
	if body.Items == nil || len(body.Items) != 0 {
		t.Fatalf("items must be an empty array: %s", response.Body.String())
	}
	if len(body.Sources) != 1 {
		t.Fatalf("sources=%s", response.Body.String())
	}
	source := body.Sources[0]
	if source.Backend != "core" || source.Status != adapter.SourceUnavailable {
		t.Fatalf("source=%+v", source)
	}
	if source.Error == nil || source.Error.Code != adapter.ErrorCodeUnavailable {
		t.Fatalf("source error=%+v", source.Error)
	}
}
