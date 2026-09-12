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

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

const (
	testOrigin   = "http://127.0.0.1:5173"
	testPassword = "correct-horse-battery"
)

func TestLoginLogoutAndEmployeeAdminFlow(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	router := testRouter(t, pool, 10)
	ctx := context.Background()
	store := employees.NewStore(pool, 2*time.Second)

	admin := createEmployee(t, ctx, store, "admin@example.invalid", "Admin", rbac.RoleAdmin)

	loginRec := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(admin.Email, testPassword), "")
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login=%d %s", loginRec.Code, loginRec.Body.String())
	}
	assertNoSecretJSONKeys(t, loginRec.Body.Bytes())
	cookie := sessionCookie(t, loginRec)

	me := doJSON(t, router, http.MethodGet, "/api/v1/me", "", cookie)
	if me.Code != http.StatusOK {
		t.Fatalf("me=%d %s", me.Code, me.Body.String())
	}
	assertNoSecretJSONKeys(t, me.Body.Bytes())

	created := doJSON(t, router, http.MethodPost, "/api/v1/system/employees", `{
		"email":"viewer@example.invalid","name":"Viewer","role":"viewer","password":"viewer-pass-1"
	}`, cookie)
	if created.Code != http.StatusCreated {
		t.Fatalf("create=%d %s", created.Code, created.Body.String())
	}
	assertNoSecretJSONKeys(t, created.Body.Bytes())
	var createdBody employeeDTO
	decodeBody(t, created, &createdBody)

	viewerLogin := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody("viewer@example.invalid", "viewer-pass-1"), "")
	if viewerLogin.Code != http.StatusOK {
		t.Fatalf("viewer login=%d %s", viewerLogin.Code, viewerLogin.Body.String())
	}
	viewerCookie := sessionCookie(t, viewerLogin)
	forbidden := doJSON(t, router, http.MethodPost, "/api/v1/system/employees", `{
		"email":"other@example.invalid","name":"Other","role":"viewer","password":"other-pass-1"
	}`, viewerCookie)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("viewer create=%d %s", forbidden.Code, forbidden.Body.String())
	}
	assertErrorCode(t, forbidden, httpx.CodeForbidden)

	role := `"operator"`
	patched := doJSON(t, router, http.MethodPatch, "/api/v1/system/employees/"+createdBody.ID, `{"role":`+role+`}`, cookie)
	if patched.Code != http.StatusOK {
		t.Fatalf("patch=%d %s", patched.Code, patched.Body.String())
	}
	stale := doJSON(t, router, http.MethodGet, "/api/v1/me", "", viewerCookie)
	if stale.Code != http.StatusUnauthorized {
		t.Fatalf("stale session=%d %s", stale.Code, stale.Body.String())
	}

	operatorLogin := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody("viewer@example.invalid", "viewer-pass-1"), "")
	if operatorLogin.Code != http.StatusOK {
		t.Fatalf("operator login=%d %s", operatorLogin.Code, operatorLogin.Body.String())
	}
	operatorCookie := sessionCookie(t, operatorLogin)
	disabled := doJSON(t, router, http.MethodPatch, "/api/v1/system/employees/"+createdBody.ID, `{"status":"disabled"}`, cookie)
	if disabled.Code != http.StatusOK {
		t.Fatalf("disable=%d %s", disabled.Code, disabled.Body.String())
	}
	afterDisable := doJSON(t, router, http.MethodGet, "/api/v1/me", "", operatorCookie)
	if afterDisable.Code != http.StatusUnauthorized {
		t.Fatalf("disabled session=%d %s", afterDisable.Code, afterDisable.Body.String())
	}

	logout := doJSON(t, router, http.MethodPost, "/api/v1/auth/logout", "", cookie)
	if logout.Code != http.StatusOK {
		t.Fatalf("logout=%d %s", logout.Code, logout.Body.String())
	}
	afterLogout := doJSON(t, router, http.MethodGet, "/api/v1/me", "", cookie)
	if afterLogout.Code != http.StatusUnauthorized {
		t.Fatalf("after logout=%d %s", afterLogout.Code, afterLogout.Body.String())
	}

	adminLogin := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(admin.Email, testPassword), "")
	adminCookie := sessionCookie(t, adminLogin)
	auditRec := doJSON(t, router, http.MethodGet, "/api/v1/system/audit?limit=100", "", adminCookie)
	if auditRec.Code != http.StatusOK {
		t.Fatalf("audit=%d %s", auditRec.Code, auditRec.Body.String())
	}
	assertNoSecretJSONKeys(t, auditRec.Body.Bytes())
	var list struct {
		Items []auditDTO `json:"items"`
	}
	decodeBody(t, auditRec, &list)
	assertAuditActions(t, list.Items, audit.ActionLogin, audit.ActionLogout, audit.ActionEmployeeCreate)
}

func TestLoginFailureUniformity(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	router := testRouter(t, pool, 20)
	ctx := context.Background()
	store := employees.NewStore(pool, 2*time.Second)
	emp := createEmployee(t, ctx, store, "user@example.invalid", "User", rbac.RoleViewer)
	status := auth.StatusDisabled
	disabled := createEmployee(t, ctx, store, "disabled@example.invalid", "Disabled", rbac.RoleViewer)
	if _, _, _, err := store.Update(ctx, disabled.ID, employees.UpdateInput{Status: &status}); err != nil {
		t.Fatal(err)
	}

	missing := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody("missing@example.invalid", testPassword), "")
	wrong := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(emp.Email, "wrong-password"), "")
	blocked := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(disabled.Email, testPassword), "")
	bodies := []string{missing.Body.String(), wrong.Body.String(), blocked.Body.String()}
	for i, rec := range []*httptest.ResponseRecorder{missing, wrong, blocked} {
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status[%d]=%d %s", i, rec.Code, rec.Body.String())
		}
		assertErrorCode(t, rec, httpx.CodeUnauthenticated)
		if !strings.Contains(bodies[i], loginFailureMessage) {
			t.Fatalf("body[%d]=%s", i, bodies[i])
		}
	}
	if extractMessage(t, missing) != extractMessage(t, wrong) || extractMessage(t, wrong) != extractMessage(t, blocked) {
		t.Fatalf("messages differ: %q %q %q", extractMessage(t, missing), extractMessage(t, wrong), extractMessage(t, blocked))
	}
}

func TestLoginRateLimit(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	router := testRouter(t, pool, 2)
	first := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody("a@example.invalid", "nope-nope"), "")
	second := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody("a@example.invalid", "nope-nope"), "")
	third := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody("a@example.invalid", "nope-nope"), "")
	if first.Code != http.StatusUnauthorized || second.Code != http.StatusUnauthorized {
		t.Fatalf("first=%d second=%d", first.Code, second.Code)
	}
	if third.Code != http.StatusTooManyRequests {
		t.Fatalf("third=%d %s", third.Code, third.Body.String())
	}
	assertErrorCode(t, third, httpx.CodeRateLimited)
}

func TestCSRFRejectedOnLogin(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	router := testRouter(t, pool, 10)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(loginBody("a@example.invalid", "nope-nope")))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "127.0.0.1:1234"
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d %s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec, httpx.CodeForbidden)
}

func testRouter(t *testing.T, pool *pgxpool.Pool, loginRate int) http.Handler {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(Dependencies{
		Employees:    employees.NewStore(pool, 2*time.Second),
		Sessions:     auth.NewService(pool, 2*time.Second, 12*time.Hour, 2*time.Hour, false),
		Audit:        audit.NewStore(pool, 2*time.Second),
		Limiter:      auth.NewLimiter(loginRate),
		PublicOrigin: testOrigin,
		Logger:       logger,
		Timeout:      2 * time.Second,
	})
}

func createEmployee(t *testing.T, ctx context.Context, store *employees.Store, email, name, role string) employees.Employee {
	t.Helper()
	hash, err := auth.Hash(testPassword)
	if err != nil {
		t.Fatal(err)
	}
	emp, err := store.Create(ctx, employees.CreateInput{Email: email, Name: name, Role: role, PasswordHash: hash})
	if err != nil {
		t.Fatal(err)
	}
	return emp
}

func loginBody(email, password string) string {
	return `{"email":"` + email + `","password":"` + password + `"}`
}

func doJSON(t *testing.T, router http.Handler, method, path, body, cookie string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.RemoteAddr = "127.0.0.1:1234"
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet && method != http.MethodHead {
		req.Header.Set("X-Requested-With", auth.RequestedWith)
		req.Header.Set("Origin", testOrigin)
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{
			Name:     auth.CookieName,
			Value:    cookie,
			Path:     "/",
			HttpOnly: true,
			Secure:   true,
			SameSite: http.SameSiteStrictMode,
		})
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func sessionCookie(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == auth.CookieName && cookie.Value != "" {
			return cookie.Value
		}
	}
	t.Fatalf("missing session cookie: %s", rec.Header().Get("Set-Cookie"))
	return ""
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder, dest any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), dest); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
}

func assertErrorCode(t *testing.T, rec *httptest.ResponseRecorder, code string) {
	t.Helper()
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeBody(t, rec, &body)
	if body.Error.Code != code {
		t.Fatalf("code=%s want %s body=%s", body.Error.Code, code, rec.Body.String())
	}
}

func extractMessage(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	decodeBody(t, rec, &body)
	return body.Error.Message
}

func assertAuditActions(t *testing.T, items []auditDTO, required ...string) {
	t.Helper()
	seen := map[string]bool{}
	for _, item := range items {
		seen[item.Action] = true
	}
	for _, action := range required {
		if !seen[action] {
			t.Fatalf("audit missing %s in %+v", action, seen)
		}
	}
}

func assertNoSecretJSONKeys(t *testing.T, raw []byte) {
	t.Helper()
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	assertNoSecretKeys(t, value)
}

func assertNoSecretKeys(t *testing.T, value any) {
	t.Helper()
	switch node := value.(type) {
	case map[string]any:
		for key, child := range node {
			lower := strings.ToLower(key)
			for _, forbidden := range []string{"secret", "token", "ciphertext", "key_hash", "password"} {
				if strings.Contains(lower, forbidden) {
					t.Errorf("forbidden JSON key %q", key)
				}
			}
			assertNoSecretKeys(t, child)
		}
	case []any:
		for _, child := range node {
			assertNoSecretKeys(t, child)
		}
	}
}
