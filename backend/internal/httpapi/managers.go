package httpapi

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/metrics"
)

func managers(deps Dependencies) http.Handler {
	h := &api{
		access:     employees.NewAccess(deps.Employees, deps.ManagerSessions, deps.Audit),
		sessions:   deps.ManagerSessions,
		audit:      deps.Audit,
		limiter:    deps.Limiter,
		trustProxy: deps.TrustProxy,
	}
	router := chi.NewRouter()
	router.Use(httpx.RequestID)
	router.Use(metrics.HTTPMiddleware)
	router.Use(httpx.Recover(deps.Logger))
	router.Use(httpx.AccessLog(deps.Logger))
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r)
		})
	})
	router.Use(auth.CSRF(deps.ManagerOrigin))
	router.NotFound(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, httpx.NotFound("not found"))
	})
	router.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, httpx.InvalidArgument("method not allowed"))
	})
	router.Method(apicontract.ManagerLogin.Method, apicontract.ManagerLogin.Path, http.HandlerFunc(h.login))
	router.Group(func(r chi.Router) {
		r.Use(deps.ManagerSessions.Middleware)
		r.Method(apicontract.ManagerLogout.Method, apicontract.ManagerLogout.Path, http.HandlerFunc(h.logout))
		r.Method(apicontract.ManagerMe.Method, apicontract.ManagerMe.Path, http.HandlerFunc(managerMe))
		r.Method(apicontract.ManagerInstallations.Method, apicontract.ManagerInstallations.Path, managerInstallations(deps.ManagerPlatform))
		r.Method(apicontract.ManagerReview.Method, apicontract.ManagerReview.Path, managerInstallationReview(deps.ManagerPlatform))
		r.Method(apicontract.ManagerOperation.Method, apicontract.ManagerOperation.Path, managerOperation(deps.ManagerPlatform))
		registerManagerAccounts(r, deps.ManagerPlatform)
	})
	return router
}

func managerMe(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	httpx.WriteJSON(w, http.StatusOK, toManagerMeDTO(principal.Account))
}

func browserHosts(adminOrigin, managerOrigin string, admin, manager http.Handler) http.Handler {
	adminURL, _ := url.Parse(adminOrigin)
	managerURL, _ := url.Parse(managerOrigin)
	reject := httpx.RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, httpx.NotFound("not found"))
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case adminURL != nil && strings.EqualFold(r.Host, adminURL.Host):
			admin.ServeHTTP(w, r)
		case managerURL != nil && strings.EqualFold(r.Host, managerURL.Host):
			manager.ServeHTTP(w, r)
		default:
			reject.ServeHTTP(w, r)
		}
	})
}
