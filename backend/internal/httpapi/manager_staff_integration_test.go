package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
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
	target := createEmployee(t, ctx, store, "staff-switch@example.invalid", "Switch", rbac.RoleAdmin)
	member := "/staff/" + target.ID.String()
	version := call("GET", member, "", true, false, "", "").Header().Get("ETag")
	patch := func(body, version, key string) *httptest.ResponseRecorder {
		t.Helper()
		return call("PATCH", member, body, true, true, key, version)
	}
	for _, body := range []string{`{}`, `{"access_enabled":null}`, `{"grants":null,"access_enabled":false}`} {
		if rec := patch(body, version, uuid.NewString()); rec.Code != 400 {
			t.Fatalf("ambiguous patch %d %s", rec.Code, rec.Body.String())
		}
	}
	assigned := patch(`{"grants":["clients.read"]}`, version, uuid.NewString())
	if assigned.Code != 200 {
		t.Fatalf("assign grants %d %s", assigned.Code, assigned.Body.String())
	}
	version = assigned.Header().Get("ETag")
	oldManager, _, err := sessions.Login(ctx, target.Email, testPassword, "127.0.0.1", "")
	if err != nil {
		t.Fatal(err)
	}
	technical := auth.NewService(pool, 5*time.Second, 12*time.Hour, 2*time.Hour, false)
	core, _, err := technical.Login(ctx, target.Email, testPassword, "127.0.0.1", "")
	if err != nil {
		t.Fatal(err)
	}
	switchKey := uuid.NewString()
	off := patch(`{"access_enabled":false}`, version, switchKey)
	if off.Code != 200 || !strings.Contains(off.Body.String(), `"status":"revoked","grants":["clients.read"]`) {
		t.Fatalf("suspend managers access %d %s", off.Code, off.Body.String())
	}
	if replay := patch(`{"access_enabled":false}`, version, switchKey); replay.Code != 200 || replay.Header().Get("ETag") != off.Header().Get("ETag") {
		t.Fatalf("access command replay %d %s", replay.Code, replay.Body.String())
	}
	if rec := patch(`{"access_enabled":true}`, version, uuid.NewString()); rec.Code != 409 {
		t.Fatalf("stale version restored access %d", rec.Code)
	}
	if _, err := sessions.Lookup(ctx, oldManager); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("suspended manager session: %v", err)
	}
	if _, _, err := sessions.Login(ctx, target.Email, testPassword, "127.0.0.1", ""); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("suspended manager login: %v", err)
	}
	if _, err := technical.Lookup(ctx, core); err != nil {
		t.Fatalf("technical session revoked: %v", err)
	}
	updated := patch(`{"grants":["feed.read"]}`, off.Header().Get("ETag"), uuid.NewString())
	if updated.Code != 200 || !strings.Contains(updated.Body.String(), `"status":"revoked","grants":["feed.read"]`) {
		t.Fatalf("suspended grants edited %d %s", updated.Code, updated.Body.String())
	}
	on := patch(`{"access_enabled":true}`, updated.Header().Get("ETag"), uuid.NewString())
	if on.Code != 200 || !strings.Contains(on.Body.String(), `"status":"active","grants":["feed.read"]`) {
		t.Fatalf("restore managers access %d %s", on.Code, on.Body.String())
	}
	if _, err := sessions.Lookup(ctx, oldManager); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("revoked session revived: %v", err)
	}
	if _, account, err := sessions.Login(ctx, target.Email, testPassword, "127.0.0.1", ""); err != nil ||
		!slices.Equal(account.ManagerGrants, []auth.ManagerGrant{auth.GrantFeedRead}) {
		t.Fatalf("restored manager grants %v: %v", account.ManagerGrants, err)
	}
	for range 4 {
		rec = call("POST", "/auth/invitations/accept", string(acceptBody), false, true, uuid.NewString(), "")
	}
	if rec.Code != 429 {
		t.Fatalf("acceptance rate control %d", rec.Code)
	}
}
