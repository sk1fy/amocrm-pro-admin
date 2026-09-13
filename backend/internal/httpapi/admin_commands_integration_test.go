package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/catalog"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestHTTPCommandAdmissionPersistenceAndPermissions(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	employeeStore := employees.NewStore(pool, 2*time.Second)
	admin := createEmployee(t, t.Context(), employeeStore, "commands-admin@example.invalid", "Admin", rbac.RoleAdmin)
	viewer := createEmployee(t, t.Context(), employeeStore, "commands-viewer@example.invalid", "Viewer", rbac.RoleViewer)
	registry := catalog.FromBackends(fixture.Demo("core"))
	router := testRouterWithRegistry(t, pool, 20, registry)
	adminCookie := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(admin.Email, testPassword), ""))
	viewerCookie := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(viewer.Email, testPassword), ""))
	path := "/api/v1/connections/core/f1a00000-0000-4000-8000-000000000001/commands/check"
	send := func(cookie, key string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{}`))
		req.Header.Set("Origin", testOrigin)
		req.Header.Set("X-Requested-With", auth.RequestedWith)
		req.Header.Set("Idempotency-Key", key)
		req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: cookie})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	if rec := send(viewerCookie, "key"); rec.Code != 403 {
		t.Fatalf("viewer=%d %s", rec.Code, rec.Body.String())
	}
	if rec := send(adminCookie, ""); rec.Code != 400 {
		t.Fatalf("missing key=%d", rec.Code)
	}
	first := send(adminCookie, "native-check")
	if first.Code != 202 {
		t.Fatalf("admission=%d %s", first.Code, first.Body.String())
	}
	assertNoSecretJSONKeys(t, first.Body.Bytes())
	var body struct {
		Operation struct {
			ID, State string
			Result    map[string]any
		}
	}
	decodeBody(t, first, &body)
	if body.Operation.State != "succeeded" || body.Operation.Result["classification"] != "auth_error" {
		t.Fatalf("check=%s", first.Body.String())
	}
	duplicate := send(adminCookie, "native-check")
	var duplicateBody struct{ Operation struct{ ID string } }
	decodeBody(t, duplicate, &duplicateBody)
	if duplicateBody.Operation.ID != body.Operation.ID {
		t.Fatal("duplicate command created operation")
	}
	// A new API instance serves the durable result after a browser/API reload.
	restarted := testRouterWithRegistry(t, pool, 20, registry)
	got := doJSON(t, restarted, http.MethodGet, "/api/v1/operations/admin/"+body.Operation.ID, "", viewerCookie)
	if got.Code != 200 || !strings.Contains(got.Body.String(), "auth_error") {
		t.Fatalf("persisted=%s", got.Body.String())
	}
	list := doJSON(t, restarted, http.MethodGet, "/api/v1/operations/admin?request_key=native-check&backend=core&target_type=installation&target_id=f1a00000-0000-4000-8000-000000000001&command=check", "", adminCookie)
	if list.Code != 200 || !strings.Contains(list.Body.String(), body.Operation.ID) {
		t.Fatalf("lookup=%s", list.Body.String())
	}
	card := doJSON(t, restarted, http.MethodGet, "/api/v1/connections/core/f1a00000-0000-4000-8000-000000000001", "", adminCookie)
	if card.Code != 200 || !strings.Contains(card.Body.String(), `"classification":"auth_error"`) {
		t.Fatalf("observation=%s", card.Body.String())
	}
	var auditCount int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM admin_audit_log WHERE action LIKE 'operation.%' AND request_id IS NOT NULL`).Scan(&auditCount); err != nil || auditCount != 2 {
		t.Fatalf("audit=%d %v", auditCount, err)
	}
}
