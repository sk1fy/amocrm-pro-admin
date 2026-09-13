package apicontract

import "net/http"

type Route struct {
	Method string
	Path   string
}

var (
	ConnectionCommand        = Route{Method: "POST", Path: "/api/v1/connections/{backend}/{connection_id}/commands/{command}"}
	IntegrationCreateCommand = Route{Method: "POST", Path: "/api/v1/integrations/{backend}/commands/create"}
	IntegrationCommand       = Route{Method: "POST", Path: "/api/v1/integrations/{backend}/{integration_id}/commands/{command}"}
	JobRetry                 = Route{Method: "POST", Path: "/api/v1/operations/jobs/{backend}/{job_id}/retry"}
	DeliveryRetry            = Route{Method: "POST", Path: "/api/v1/connections/{backend}/{connection_id}/deliveries/{delivery_id}/retry"}
	AdminOperations          = Route{Method: "GET", Path: "/api/v1/operations/admin"}
	AdminOperation           = Route{Method: "GET", Path: "/api/v1/operations/admin/{id}"}
	AuthLogin                = Route{Method: http.MethodPost, Path: "/api/v1/auth/login"}
	AuthLogout               = Route{Method: http.MethodPost, Path: "/api/v1/auth/logout"}
	Me                       = Route{Method: http.MethodGet, Path: "/api/v1/me"}
	MeSessions               = Route{Method: http.MethodGet, Path: "/api/v1/me/sessions"}
	MeSessionRevoke          = Route{Method: http.MethodDelete, Path: "/api/v1/me/sessions/{id}"}
	SystemEmployees          = Route{Method: http.MethodGet, Path: "/api/v1/system/employees"}
	SystemEmployeesCreate    = Route{Method: http.MethodPost, Path: "/api/v1/system/employees"}
	SystemEmployee           = Route{Method: http.MethodPatch, Path: "/api/v1/system/employees/{id}"}
	SystemEmployeeRevoke     = Route{Method: http.MethodPost, Path: "/api/v1/system/employees/{id}/sessions/revoke"}
	SystemAudit              = Route{Method: http.MethodGet, Path: "/api/v1/system/audit"}
	Accounts                 = Route{Method: http.MethodGet, Path: "/api/v1/accounts"}
	Account                  = Route{Method: http.MethodGet, Path: "/api/v1/accounts/{account_id}"}
	AccountJobs              = Route{Method: http.MethodGet, Path: "/api/v1/accounts/{account_id}/jobs"}
	AccountHistory           = Route{Method: http.MethodGet, Path: "/api/v1/accounts/{account_id}/history"}
	Connection               = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}"}
	ConnectionJobs           = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/jobs"}
	ConnectionAudit          = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/audit"}
	Catalog                  = Route{Method: http.MethodGet, Path: "/api/v1/catalog"}
	Integrations             = Route{Method: http.MethodGet, Path: "/api/v1/integrations"}
	Integration              = Route{Method: http.MethodGet, Path: "/api/v1/integrations/{backend}/{integration_id}"}
	OperationsJobs           = Route{Method: http.MethodGet, Path: "/api/v1/operations/jobs"}
	OperationsJob            = Route{Method: http.MethodGet, Path: "/api/v1/operations/jobs/{backend}/{job_id}"}
	SystemBackends           = Route{Method: http.MethodGet, Path: "/api/v1/system/backends"}

	Routes = []Route{
		ConnectionCommand, IntegrationCreateCommand, IntegrationCommand, JobRetry, DeliveryRetry, AdminOperations, AdminOperation,
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
		Accounts,
		Account,
		AccountHistory,
		AccountJobs,
		Connection,
		ConnectionJobs,
		ConnectionAudit,
		Catalog,
		Integrations,
		Integration,
		OperationsJobs,
		OperationsJob,
		SystemBackends,
	}
)
