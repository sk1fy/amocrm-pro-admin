package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
)

const maxBodyBytes = 1 << 20

type Dependencies struct {
	Employees    *employees.Store
	Sessions     *auth.Service
	Audit        *audit.Store
	Limiter      *auth.Limiter
	PublicOrigin string
	Logger       *slog.Logger
	Timeout      time.Duration
}

type api struct {
	employees *employees.Store
	sessions  *auth.Service
	audit     *audit.Store
	limiter   *auth.Limiter
}

func New(deps Dependencies) http.Handler {
	h := &api{
		employees: deps.Employees,
		sessions:  deps.Sessions,
		audit:     deps.Audit,
		limiter:   deps.Limiter,
	}
	router := chi.NewRouter()
	router.Use(httpx.RequestID)
	router.Use(httpx.Recover(deps.Logger))
	router.Use(httpx.AccessLog(deps.Logger))
	router.Use(auth.CSRF(deps.PublicOrigin))
	router.NotFound(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, httpx.NotFound("not found"))
	})
	router.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, httpx.InvalidArgument("method not allowed"))
	})

	router.Method(apicontract.AuthLogin.Method, apicontract.AuthLogin.Path, http.HandlerFunc(h.login))

	router.Group(func(r chi.Router) {
		r.Use(deps.Sessions.Middleware)
		r.Method(apicontract.AuthLogout.Method, apicontract.AuthLogout.Path, http.HandlerFunc(h.logout))
		r.Method(apicontract.Me.Method, apicontract.Me.Path, http.HandlerFunc(h.me))

		r.Group(func(r chi.Router) {
			r.Use(rbac.Require(rbac.SessionsSelf, deps.Employees))
			r.Method(apicontract.MeSessions.Method, apicontract.MeSessions.Path, http.HandlerFunc(h.listOwnSessions))
			r.Method(apicontract.MeSessionRevoke.Method, apicontract.MeSessionRevoke.Path, http.HandlerFunc(h.revokeOwnSession))
		})
		r.Group(func(r chi.Router) {
			r.Use(rbac.Require(rbac.EmployeesRead, deps.Employees))
			r.Method(apicontract.SystemEmployees.Method, apicontract.SystemEmployees.Path, http.HandlerFunc(h.listEmployees))
		})
		r.Group(func(r chi.Router) {
			r.Use(rbac.Require(rbac.EmployeesWrite, deps.Employees))
			r.Method(apicontract.SystemEmployeesCreate.Method, apicontract.SystemEmployeesCreate.Path, http.HandlerFunc(h.createEmployee))
			r.Method(apicontract.SystemEmployee.Method, apicontract.SystemEmployee.Path, http.HandlerFunc(h.patchEmployee))
			r.Method(apicontract.SystemEmployeeRevoke.Method, apicontract.SystemEmployeeRevoke.Path, http.HandlerFunc(h.revokeEmployeeSessions))
		})
		r.Group(func(r chi.Router) {
			r.Use(rbac.Require(rbac.AuditRead, deps.Employees))
			r.Method(apicontract.SystemAudit.Method, apicontract.SystemAudit.Path, http.HandlerFunc(h.listAudit))
		})
	})
	return router
}

func Management(pool *pgxpool.Pool, timeout time.Duration, logger *slog.Logger) http.Handler {
	router := chi.NewRouter()
	router.Use(httpx.RequestID)
	router.Use(httpx.Recover(logger))
	router.Use(httpx.AccessLog(logger))
	router.Get("/live", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := contextWithTimeout(r, timeout)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	return router
}

func decodeJSON(r *http.Request, dest any) error {
	defer func() { _ = r.Body.Close() }()
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		return httpx.InvalidArgument("invalid request body")
	}
	return nil
}
