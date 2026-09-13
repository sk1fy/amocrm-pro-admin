package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sk1fy/amocrm-pro-admin/internal/accounts"
	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/catalog"
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
	TrustProxy   bool
	Logger       *slog.Logger
	Timeout      time.Duration
	Registry     *catalog.Registry
	Accounts     *accounts.Service
}

type api struct {
	employees  *employees.Store
	sessions   *auth.Service
	audit      *audit.Store
	limiter    *auth.Limiter
	registry   *catalog.Registry
	accounts   *accounts.Service
	trustProxy bool
}

func New(deps Dependencies) http.Handler {
	registry := deps.Registry
	if registry == nil {
		registry = catalog.FromBackends()
	}
	accountSvc := deps.Accounts
	if accountSvc == nil {
		accountSvc = accounts.New(registry.Backends(), deps.Audit)
	}
	h := &api{
		employees:  deps.Employees,
		sessions:   deps.Sessions,
		audit:      deps.Audit,
		limiter:    deps.Limiter,
		registry:   registry,
		accounts:   accountSvc,
		trustProxy: deps.TrustProxy,
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
			r.Method(apicontract.AccountHistory.Method, apicontract.AccountHistory.Path, http.HandlerFunc(h.accountHistory))
			r.Method(apicontract.ConnectionAudit.Method, apicontract.ConnectionAudit.Path, http.HandlerFunc(h.listConnectionAudit))
		})
		r.Group(func(r chi.Router) {
			r.Use(rbac.Require(rbac.AccountsRead, deps.Employees))
			r.Method(apicontract.Accounts.Method, apicontract.Accounts.Path, http.HandlerFunc(h.listAccounts))
			r.Method(apicontract.Account.Method, apicontract.Account.Path, http.HandlerFunc(h.getAccount))
		})
		r.Group(func(r chi.Router) {
			r.Use(rbac.Require(rbac.ConnectionsRead, deps.Employees))
			r.Method(apicontract.Connection.Method, apicontract.Connection.Path, http.HandlerFunc(h.getConnection))
		})
		r.Group(func(r chi.Router) {
			r.Use(rbac.Require(rbac.OperationsRead, deps.Employees))
			r.Method(apicontract.AccountJobs.Method, apicontract.AccountJobs.Path, http.HandlerFunc(h.accountJobs))
			r.Method(apicontract.ConnectionJobs.Method, apicontract.ConnectionJobs.Path, http.HandlerFunc(h.listConnectionJobs))
			r.Method(apicontract.OperationsJobs.Method, apicontract.OperationsJobs.Path, http.HandlerFunc(h.listJobs))
			r.Method(apicontract.OperationsJob.Method, apicontract.OperationsJob.Path, http.HandlerFunc(h.getJob))
		})
		r.Group(func(r chi.Router) {
			r.Use(rbac.Require(rbac.IntegrationsRead, deps.Employees))
			r.Method(apicontract.Integrations.Method, apicontract.Integrations.Path, http.HandlerFunc(h.listIntegrations))
			r.Method(apicontract.Integration.Method, apicontract.Integration.Path, http.HandlerFunc(h.getIntegration))
		})
		r.Group(func(r chi.Router) {
			r.Use(rbac.Require(rbac.SystemRead, deps.Employees))
			r.Method(apicontract.Catalog.Method, apicontract.Catalog.Path, http.HandlerFunc(h.catalog))
			r.Method(apicontract.SystemBackends.Method, apicontract.SystemBackends.Path, http.HandlerFunc(h.listBackends))
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
