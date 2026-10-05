package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/catalog"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestDistributionReadCommandRBACAndDurableReplay(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	store := employees.NewStore(pool, 2*time.Second)
	admin := createEmployee(t, t.Context(), store, "distribution-admin@example.invalid", "Admin", rbac.RoleAdmin)
	viewer := createEmployee(t, t.Context(), store, "distribution-viewer@example.invalid", "Viewer", rbac.RoleViewer)
	registry := catalog.FromBackends(fixture.Demo("core"))
	router := testRouterWithRegistry(t, pool, 20, registry)
	ac := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(admin.Email, testPassword), ""))
	vc := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(viewer.Email, testPassword), ""))
	base := "/api/v1/connections/core/f1a00000-0000-4000-8000-000000000001"
	for _, path := range []string{base + "/distribution", base + "/distribution/trace?limit=1"} {
		r := doJSON(t, router, http.MethodGet, path, "", vc)
		if r.Code != 200 {
			t.Fatalf("read %s %d %s", path, r.Code, r.Body.String())
		}
		assertNoSecretJSONKeys(t, r.Body.Bytes())
	}
	bad := doJSON(t, router, http.MethodGet, base+"/distribution/trace?reference=not-a-uuid", "", vc)
	if bad.Code != 400 {
		t.Fatal("invalid search admitted")
	}
	unknown := doJSON(t, router, http.MethodGet, "/api/v1/connections/core/d1500000-0000-4000-8000-000000000009/distribution", "", vc)
	if unknown.Code != 404 {
		t.Fatal("foreign installation visible")
	}
	send := func(cookie, key, command, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, base+"/commands/"+command, strings.NewReader(body))
		req.Header.Set("Origin", testOrigin)
		req.Header.Set("X-Requested-With", auth.RequestedWith)
		req.Header.Set("Idempotency-Key", key)
		req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: cookie})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	for _, c := range []string{"distribution-pause", "distribution-resume", "distribution-reconcile", "distribution-delivery-retry"} {
		if r := send(vc, "denied-"+c, c, `{}`); r.Code != 403 {
			t.Fatalf("viewer admitted %s: %s", c, r.Body.String())
		}
	}
	first := send(ac, "distribution-pause-1", "distribution-pause", `{"expected_paused":false}`)
	if first.Code != 202 {
		t.Fatalf("pause %d %s", first.Code, first.Body.String())
	}
	assertNoSecretJSONKeys(t, first.Body.Bytes())
	var a, b struct {
		Operation struct {
			ID, State string
			Result    map[string]any
		}
	}
	decodeBody(t, first, &a)
	repeat := send(ac, "distribution-pause-1", "distribution-pause", `{"expected_paused":false}`)
	decodeBody(t, repeat, &b)
	if a.Operation.ID != b.Operation.ID || a.Operation.State != "succeeded" {
		t.Fatal("repeat changed operation")
	}
	changed := send(ac, "distribution-pause-1", "distribution-pause", `{"expected_paused":true}`)
	if changed.Code != 409 {
		t.Fatal("changed key body accepted")
	}
	summary := doJSON(t, router, http.MethodGet, base+"/distribution", "", vc)
	if !strings.Contains(summary.Body.String(), `"paused":true`) {
		t.Fatal("pause not observable")
	}
	retry := send(ac, "distribution-delivery-1", "distribution-delivery-retry", `{"kind":"results","message_id":"d1500000-0000-4000-8000-000000000003","expected_attempts":3}`)
	decodeBody(t, retry, &a)
	if retry.Code != 202 {
		t.Fatalf("delivery %s", retry.Body.String())
	}
	reconcile := send(ac, "distribution-reconcile-1", "distribution-reconcile", `{"operation_id":"d1500000-0000-4000-8000-000000000002","expected_result_version":1}`)
	decodeBody(t, reconcile, &a)
	if reconcile.Code != 202 || a.Operation.State != "pending" {
		t.Fatalf("reconcile claimed success %s", reconcile.Body.String())
	}
	var data map[string]any
	if json.Unmarshal(retry.Body.Bytes(), &data) != nil {
		t.Fatal("invalid json")
	}
	assertNoSecretJSONKeys(t, retry.Body.Bytes())
	restarted := testRouterWithRegistry(t, pool, 20, registry)
	read := doJSON(t, restarted, http.MethodGet, "/api/v1/operations/admin/"+a.Operation.ID, "", vc)
	if read.Code != 200 {
		t.Fatal("receipt lost on restart")
	}
}
func TestDistributionNoCapabilityDoesNotBecomeEmptySuccess(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	store := employees.NewStore(pool, 2*time.Second)
	viewer := createEmployee(t, t.Context(), store, "distribution-cap@example.invalid", "Viewer", rbac.RoleViewer)
	backend := fixture.New(fixture.Options{Code: "limited", Caps: &adapter.Capabilities{Connections: true}})
	router := testRouterWithRegistry(t, pool, 20, catalog.FromBackends(backend))
	cookie := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(viewer.Email, testPassword), ""))
	for _, suffix := range []string{"", "/trace"} {
		r := doJSON(t, router, http.MethodGet, "/api/v1/connections/limited/f1a00000-0000-4000-8000-000000000001/distribution"+suffix, "", cookie)
		if r.Code != 200 || !strings.Contains(r.Body.String(), `"freshness":"unknown"`) || strings.Contains(r.Body.String(), `"data"`) {
			t.Fatalf("unsupported %s", r.Body.String())
		}
	}
}
