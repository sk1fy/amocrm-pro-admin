package apicontract

import "net/http"

type Route struct {
	Method string
	Path   string
}

var (
	AuthLogin             = Route{Method: http.MethodPost, Path: "/api/v1/auth/login"}
	AuthLogout            = Route{Method: http.MethodPost, Path: "/api/v1/auth/logout"}
	Me                    = Route{Method: http.MethodGet, Path: "/api/v1/me"}
	MeSessions            = Route{Method: http.MethodGet, Path: "/api/v1/me/sessions"}
	MeSessionRevoke       = Route{Method: http.MethodDelete, Path: "/api/v1/me/sessions/{id}"}
	SystemEmployees       = Route{Method: http.MethodGet, Path: "/api/v1/system/employees"}
	SystemEmployeesCreate = Route{Method: http.MethodPost, Path: "/api/v1/system/employees"}
	SystemEmployee        = Route{Method: http.MethodPatch, Path: "/api/v1/system/employees/{id}"}
	SystemEmployeeRevoke  = Route{Method: http.MethodPost, Path: "/api/v1/system/employees/{id}/sessions/revoke"}
	SystemAudit           = Route{Method: http.MethodGet, Path: "/api/v1/system/audit"}

	Routes = []Route{
		AuthLogin,
		AuthLogout,
		Me,
		MeSessions,
		MeSessionRevoke,
		SystemEmployees,
		SystemEmployeesCreate,
		SystemEmployee,
		SystemEmployeeRevoke,
		SystemAudit,
	}
)
