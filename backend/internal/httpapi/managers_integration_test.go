package httpapi

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestManagerSessionBoundary(t *testing.T) {
	const adminOrigin = "https://core-admin.example.invalid"
	const managerOrigin = "https://managers.example.invalid"
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := t.Context()
	store := employees.NewStore(pool, 5*time.Second)
	coreSessions := auth.NewService(pool, 5*time.Second, 12*time.Hour, 2*time.Hour, true)
	managerSessions := auth.NewManagerService(pool, 5*time.Second, 12*time.Hour, 2*time.Hour, true)
	audits := audit.NewStore(pool, 5*time.Second)
	access := employees.NewAccess(store, coreSessions, audits)
	router := New(Dependencies{
		Employees: store, Sessions: coreSessions, ManagerSessions: managerSessions,
		Audit: audits, Limiter: auth.NewLimiter(50), Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		PublicOrigin: adminOrigin, ManagerOrigin: managerOrigin,
	})
	manager := createEmployee(t, ctx, store, "manager@example.invalid", "Manager", rbac.RoleViewer)
	technical := createEmployee(t, ctx, store, "technical@example.invalid", "Technical", rbac.RoleAdmin)

	request := func(route apicontract.Route, host, origin, body string, cookie *http.Cookie, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(route.Method, host+route.Path, strings.NewReader(body))
		req.Header.Set("Origin", origin)
		req.Header.Set("X-Requested-With", auth.RequestedWith)
		req.Header.Set("X-Forwarded-Host", strings.TrimPrefix(managerOrigin, "https://"))
		if cookie != nil {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Fatalf("%s %s: got %d, want %d. Body: %s", route.Method, req.URL, rec.Code, want, rec.Body.String())
		}
		return rec
	}
	login := func(route apicontract.Route, host, email string, want int) *httptest.ResponseRecorder {
		t.Helper()
		return request(route, host, host, loginBody(email, testPassword), nil, want)
	}
	cookie := func(rec *httptest.ResponseRecorder, name string) *http.Cookie {
		t.Helper()
		cookies := rec.Result().Cookies()
		if len(cookies) != 1 || cookies[0].Name != name {
			t.Fatal("expected one cookie of the selected audience")
		}
		session := cookies[0]
		if !session.HttpOnly || !session.Secure || session.SameSite != http.SameSiteStrictMode || session.Domain != "" {
			t.Fatal("expected a host-only, strict, secure HttpOnly cookie")
		}
		return session
	}

	request(apicontract.ManagerMe, managerOrigin, "", "", nil, http.StatusUnauthorized)
	request(apicontract.ManagerMe, adminOrigin, "", "", nil, http.StatusNotFound)
	request(apicontract.ManagerMe, "https://other.example.invalid", "", "", nil, http.StatusNotFound)
	request(apicontract.Me, managerOrigin, "", "", nil, http.StatusNotFound)
	request(apicontract.ManagerLogin, managerOrigin, adminOrigin, loginBody(manager.Email, testPassword), nil, http.StatusForbidden)

	denied := login(apicontract.ManagerLogin, managerOrigin, technical.Email, http.StatusUnauthorized)
	unknown := login(apicontract.ManagerLogin, managerOrigin, "unknown@example.invalid", http.StatusUnauthorized)
	if len(denied.Result().Cookies()) != 0 || len(unknown.Result().Cookies()) != 0 {
		t.Fatal("rejected credentials issued a cookie")
	}

	coreCookie := cookie(login(apicontract.AuthLogin, adminOrigin, manager.Email, http.StatusOK), auth.CookieName)
	request(apicontract.ManagerMe, managerOrigin, "", "", coreCookie, http.StatusUnauthorized)
	wrongAudience := &http.Cookie{Name: auth.ManagerCookieName, Value: coreCookie.Value}
	request(apicontract.ManagerMe, managerOrigin, "", "", wrongAudience, http.StatusUnauthorized)
	if err := access.BootstrapManager(ctx, manager.Email, audit.Event{}); err != nil {
		t.Fatal(err)
	}
	if err := access.BootstrapManager(ctx, manager.Email, audit.Event{}); err != nil {
		t.Fatalf("repeat bootstrap: %v", err)
	}
	if err := access.BootstrapManager(ctx, technical.Email, audit.Event{}); !errors.Is(err, employees.ErrManagerBootstrapComplete) {
		t.Fatalf("second administrator: %v", err)
	}
	var bootstrapAudits int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM admin_audit_log WHERE action = $1", audit.ActionManagerBootstrap).Scan(&bootstrapAudits); err != nil || bootstrapAudits != 1 {
		t.Fatalf("bootstrap audits = %d, err = %v", bootstrapAudits, err)
	}

	loggedIn := login(apicontract.ManagerLogin, managerOrigin, manager.Email, http.StatusOK)
	managerCookie := cookie(loggedIn, auth.ManagerCookieName)
	assertNoSecretJSONKeys(t, loggedIn.Body.Bytes())
	wrongAudience = &http.Cookie{Name: auth.CookieName, Value: managerCookie.Value}
	request(apicontract.Me, adminOrigin, "", "", wrongAudience, http.StatusUnauthorized)
	profile := request(apicontract.ManagerMe, managerOrigin, "", "", managerCookie, http.StatusOK)
	var session managerMeDTO
	decodeBody(t, profile, &session)
	if session.ID != manager.ID.String() || !slices.Equal(session.Grants, auth.ManagerAdminGrants()) {
		t.Fatalf("manager profile mismatch: %+v", session)
	}
	if strings.Contains(profile.Body.String(), `"role"`) || profile.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("manager session exposed technical role or missed no-store")
	}
	if sessions, err := coreSessions.ListOwn(ctx, manager.ID); err != nil || len(sessions) != 1 {
		t.Fatalf("technical session list length = %d, err = %v", len(sessions), err)
	}
	managerPrincipal, err := managerSessions.Lookup(ctx, managerCookie.Value)
	if err != nil {
		t.Fatal(err)
	}
	if err := coreSessions.RevokeOwned(ctx, managerPrincipal.SessionID, manager.ID, auth.ReasonLogout); !errors.Is(err, auth.ErrNotFound) {
		t.Fatalf("technical self-revoke accepted manager session: %v", err)
	}
	request(apicontract.ManagerLogout, managerOrigin, adminOrigin, "", managerCookie, http.StatusForbidden)
	request(apicontract.ManagerLogout, managerOrigin, managerOrigin, "", managerCookie, http.StatusOK)
	request(apicontract.ManagerMe, managerOrigin, "", "", managerCookie, http.StatusUnauthorized)
	request(apicontract.Me, adminOrigin, "", "", coreCookie, http.StatusOK)

	managerCookie = cookie(login(apicontract.ManagerLogin, managerOrigin, manager.Email, http.StatusOK), auth.ManagerCookieName)
	if _, err := pool.Exec(ctx, "DELETE FROM manager_grants WHERE employee_id = $1 AND grant_code = $2", manager.ID, auth.GrantClientsRead); err != nil {
		t.Fatal(err)
	}
	profile = request(apicontract.ManagerMe, managerOrigin, "", "", managerCookie, http.StatusOK)
	decodeBody(t, profile, &session)
	if slices.Contains(session.Grants, auth.GrantClientsRead) {
		t.Fatal("session preserved a revoked grant")
	}
	operator := rbac.RoleOperator
	if _, err := access.Update(ctx, manager.ID, employees.UpdateInput{Role: &operator}, audit.Event{}); err != nil {
		t.Fatal(err)
	}
	request(apicontract.ManagerMe, managerOrigin, "", "", managerCookie, http.StatusOK)
	request(apicontract.Me, adminOrigin, "", "", coreCookie, http.StatusUnauthorized)
	coreCookie = cookie(login(apicontract.AuthLogin, adminOrigin, manager.Email, http.StatusOK), auth.CookieName)
	if _, err := pool.Exec(ctx, "DELETE FROM manager_grants WHERE employee_id = $1", manager.ID); err != nil {
		t.Fatal(err)
	}
	request(apicontract.ManagerMe, managerOrigin, "", "", managerCookie, http.StatusUnauthorized)
	request(apicontract.Me, adminOrigin, "", "", coreCookie, http.StatusOK)

	if err := access.BootstrapManager(ctx, manager.Email, audit.Event{}); err != nil {
		t.Fatal(err)
	}
	managerCookie = cookie(login(apicontract.ManagerLogin, managerOrigin, manager.Email, http.StatusOK), auth.ManagerCookieName)
	disabled := auth.StatusDisabled
	if _, err := access.Update(ctx, manager.ID, employees.UpdateInput{Status: &disabled}, audit.Event{}); err != nil {
		t.Fatal(err)
	}
	request(apicontract.ManagerMe, managerOrigin, "", "", managerCookie, http.StatusUnauthorized)
	request(apicontract.Me, adminOrigin, "", "", coreCookie, http.StatusUnauthorized)
	login(apicontract.ManagerLogin, managerOrigin, manager.Email, http.StatusUnauthorized)
}

func TestManagerBootstrapConcurrent(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := t.Context()
	store := employees.NewStore(pool, 5*time.Second)
	audits := audit.NewStore(pool, 5*time.Second)
	access := employees.NewAccess(store, auth.NewService(pool, 5*time.Second, 12*time.Hour, 2*time.Hour, false), audits)
	first := createEmployee(t, ctx, store, "first@example.invalid", "First", rbac.RoleViewer)
	second := createEmployee(t, ctx, store, "second@example.invalid", "Second", rbac.RoleViewer)
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, employee := range []employees.Employee{first, second} {
		go func() {
			<-start
			results <- access.BootstrapManager(ctx, employee.Email, audit.Event{})
		}()
	}
	close(start)
	firstResult, secondResult := <-results, <-results
	if !((firstResult == nil && errors.Is(secondResult, employees.ErrManagerBootstrapComplete)) ||
		(secondResult == nil && errors.Is(firstResult, employees.ErrManagerBootstrapComplete))) {
		t.Fatalf("bootstrap outcomes: %v, %v", firstResult, secondResult)
	}
}
