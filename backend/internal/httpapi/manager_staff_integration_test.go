package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestManagerStaffHTTPContractAndPublicAcceptanceControls(t *testing.T) {
	const origin = "https://manager.example.invalid"
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := context.Background()
	store := employees.NewStore(pool, 5*time.Second)
	sessions := auth.NewManagerService(pool, 5*time.Second, 12*time.Hour, 2*time.Hour, false)
	audits := audit.NewStore(pool, 5*time.Second)
	actor := createEmployee(t, ctx, store, "staff-http@example.invalid", "Staff", rbac.RoleAdmin)
	access := employees.NewAccess(store, sessions, audits)
	if err := access.BootstrapManager(ctx, actor.Email, audit.Event{}); err != nil {
		t.Fatal(err)
	}
	token, _, err := sessions.Login(ctx, actor.Email, testPassword, "127.0.0.1", "")
	if err != nil {
		t.Fatal(err)
	}
	router := New(Dependencies{Employees: store, Sessions: auth.NewService(pool, 5*time.Second, 12*time.Hour, 2*time.Hour, false), ManagerSessions: sessions, Audit: audits, Limiter: auth.NewLimiter(5), Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), PublicOrigin: "https://admin.example.invalid", ManagerOrigin: origin})
	call := func(method, path, body string, session bool, csrf bool, key string, version string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, origin+"/api/v1/managers"+path, strings.NewReader(body))
		req.RemoteAddr = "127.0.0.1:12345"
		if session {
			req.AddCookie(&http.Cookie{Name: auth.ManagerCookieName, Value: token})
		}
		if csrf {
			req.Header.Set("Origin", origin)
			req.Header.Set("X-Requested-With", auth.RequestedWith)
		}
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		if version != "" {
			req.Header.Set("If-Match", version)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	if rec := call("GET", "/staff", "", false, false, "", ""); rec.Code != 401 {
		t.Fatalf("anonymous list %d", rec.Code)
	}
	if rec := call("GET", "/staff?limit=101", "", true, false, "", ""); rec.Code != 400 {
		t.Fatalf("unbounded list %d", rec.Code)
	}
	if rec := call("POST", "/staff", `{"email":"new@example.invalid","name":"New","grants":["clients.read"]}`, true, false, uuid.NewString(), ""); rec.Code != 403 {
		t.Fatalf("missing CSRF %d", rec.Code)
	}
	if rec := call("POST", "/staff", `{"email":"new@example.invalid","name":"A","name":"B","grants":["clients.read"]}`, true, true, uuid.NewString(), ""); rec.Code != 400 {
		t.Fatalf("duplicate field %d %s", rec.Code, rec.Body.String())
	}
	rec := call("POST", "/staff", `{"email":"new@example.invalid","name":"New","grants":["clients.read"]}`, true, true, uuid.NewString(), "")
	if rec.Code != 201 || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("invite %d %s", rec.Code, rec.Body.String())
	}
	assertNoSecretJSONKeys(t, rec.Body.Bytes())
	var result employees.StaffResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	invitation := strings.Split(result.InvitationURL, "#invitation=")
	if len(invitation) != 2 {
		t.Fatal("invitation must use fragment")
	}
	acceptBody, _ := json.Marshal(map[string]string{"token": invitation[1], "password": "fixture-accepted-password"})
	if rec := call("POST", "/auth/invitations/accept", string(acceptBody), false, false, uuid.NewString(), ""); rec.Code != 403 {
		t.Fatalf("public acceptance missing CSRF %d", rec.Code)
	}
	key := uuid.NewString()
	rec = call("POST", "/auth/invitations/accept", string(acceptBody), false, true, key, "")
	if rec.Code != 200 {
		t.Fatalf("accept %d %s", rec.Code, rec.Body.String())
	}
	rec = call("POST", "/auth/invitations/accept", string(acceptBody), false, true, key, "")
	if rec.Code != 200 {
		t.Fatalf("exact acceptance replay %d", rec.Code)
	}
	for range 4 {
		rec = call("POST", "/auth/invitations/accept", string(acceptBody), false, true, uuid.NewString(), "")
	}
	if rec.Code != 429 {
		t.Fatalf("acceptance rate control %d", rec.Code)
	}
}
