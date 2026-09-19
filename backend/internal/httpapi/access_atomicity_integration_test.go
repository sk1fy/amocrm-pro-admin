package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestAccessChangesRollBackOnAuditOrRevokeFailure(t *testing.T) {
	for _, scenario := range []string{"create", "update", "revoke_all", "revoke_own", "logout", "revoke_failure"} {
		t.Run(scenario, func(t *testing.T) {
			pool := testkit.Postgres(t)
			testkit.Reset(t, pool)
			ctx := context.Background()
			store := employees.NewStore(pool, 2*time.Second)
			admin := createEmployee(t, ctx, store, "admin@example.invalid", "Admin", rbac.RoleAdmin)
			target := createEmployee(t, ctx, store, "target@example.invalid", "Before", rbac.RoleOperator)
			router := testRouter(t, pool, 20)
			cookie := accessTestSession(t, pool, admin.ID)
			sessions := auth.NewService(pool, 2*time.Second, time.Hour, time.Hour, false)
			token := accessTestSession(t, pool, target.ID)
			principal, err := sessions.Lookup(ctx, token)
			if err != nil {
				t.Fatal(err)
			}
			method, path, body := http.MethodPost, "/api/v1/system/employees/"+target.ID.String()+"/sessions/revoke", ""
			switch scenario {
			case "create":
				path = "/api/v1/system/employees"
				body = `{"email":"new@example.invalid","name":"New","role":"viewer","password":"fixture-password"}`
			case "update", "revoke_failure":
				method = http.MethodPatch
				path = "/api/v1/system/employees/" + target.ID.String()
				body = `{"name":"Changed","role":"viewer","status":"disabled"}`
			case "revoke_own":
				method = http.MethodDelete
				path = "/api/v1/me/sessions/" + principal.SessionID.String()
				cookie = token
			case "logout":
				path = "/api/v1/auth/logout"
				cookie = token
			}
			table, constraint := "admin_audit_log", "CHECK (false)"
			if scenario == "revoke_failure" {
				table, constraint = "sessions", "CHECK (revoked_at IS NULL)"
			}
			if _, err := pool.Exec(ctx, "ALTER TABLE "+table+" ADD CONSTRAINT audit_test_failure "+constraint+" NOT VALID"); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if _, err := pool.Exec(context.Background(), "ALTER TABLE "+table+" DROP CONSTRAINT audit_test_failure"); err != nil {
					t.Error(err)
				}
			})
			var beforeAudit int
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM admin_audit_log").Scan(&beforeAudit); err != nil {
				t.Fatal(err)
			}
			rec := doJSON(t, router, method, path, body, cookie)
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("response=%d %s", rec.Code, rec.Body.String())
			}
			current, err := store.GetRecord(ctx, target.ID)
			if err != nil || current.Name != target.Name || current.Role != target.Role || current.Status != auth.StatusActive {
				t.Fatalf("partial employee change: %+v %v", current, err)
			}
			var revoked, newEmployees, afterAudit int
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM sessions WHERE revoked_at IS NOT NULL").Scan(&revoked); err != nil {
				t.Fatal(err)
			}
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM employees WHERE email='new@example.invalid'").Scan(&newEmployees); err != nil {
				t.Fatal(err)
			}
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM admin_audit_log").Scan(&afterAudit); err != nil {
				t.Fatal(err)
			}
			if revoked != 0 || newEmployees != 0 || afterAudit != beforeAudit {
				t.Fatalf("partial commit: revoked=%d created=%d audit=%d/%d", revoked, newEmployees, afterAudit, beforeAudit)
			}
		})
	}
}

func TestLoginInfrastructureErrorsAreNotInvalidCredentials(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := context.Background()
	store := employees.NewStore(pool, 2*time.Second)
	emp := createEmployee(t, ctx, store, "login@example.invalid", "Login", rbac.RoleAdmin)
	router := testRouter(t, pool, 20)
	for _, body := range []string{loginBody(emp.Email, "wrong-password"), loginBody("missing@example.invalid", testPassword)} {
		rec := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", body, "")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("invalid credentials=%d", rec.Code)
		}
		assertErrorCode(t, rec, httpx.CodeUnauthenticated)
	}
	if _, err := pool.Exec(ctx, "ALTER TABLE sessions ADD CONSTRAINT login_test_failure CHECK(false) NOT VALID"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := pool.Exec(context.Background(), "ALTER TABLE sessions DROP CONSTRAINT login_test_failure")
		if err != nil {
			t.Error(err)
		}
	})
	rec := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(emp.Email, testPassword), "")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("insert failure=%d %s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec, httpx.CodeInternal)
	if rec.Header().Get("X-Request-ID") == "" || len(rec.Result().Cookies()) != 0 {
		t.Fatal("missing request id or issued cookie on failed login")
	}
	closed, err := pgxpool.NewWithConfig(ctx, pool.Config())
	if err != nil {
		t.Fatal(err)
	}
	closed.Close()
	rec = doJSON(t, testRouter(t, closed, 20), http.MethodPost, "/api/v1/auth/login", loginBody(emp.Email, testPassword), "")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("unavailable database=%d %s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec, httpx.CodeInternal)
}

// Session fixtures keep rollback tests independent of password hashing and login.
func accessTestSession(t *testing.T, pool *pgxpool.Pool, employeeID uuid.UUID) string {
	t.Helper()
	token, hash, err := auth.NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `INSERT INTO sessions (employee_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, employeeID, hash); err != nil {
		t.Fatal(err)
	}
	return token
}
