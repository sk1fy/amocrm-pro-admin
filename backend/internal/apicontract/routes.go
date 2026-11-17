package apicontract

import "net/http"

type Route struct {
	Method string
	Path   string
}

const ManagerPrefix = "/api/v1/managers"

var (
	ManagerLogin                  = Route{Method: http.MethodPost, Path: ManagerPrefix + "/auth/login"}
	ManagerLogout                 = Route{Method: http.MethodPost, Path: ManagerPrefix + "/auth/logout"}
	ManagerOperation              = Route{Method: http.MethodGet, Path: ManagerPrefix + "/operations/{id}"}
	ManagerInstallations          = Route{Method: http.MethodGet, Path: ManagerPrefix + "/installations"}
	ManagerReview                 = Route{Method: http.MethodPut, Path: ManagerPrefix + "/installations/{id}/review"}
	ManagerAccounts               = Route{Method: http.MethodGet, Path: ManagerPrefix + "/accounts"}
	ManagerAccountSearch          = Route{Method: http.MethodPost, Path: ManagerPrefix + "/accounts/search"}
	ManagerAccount                = Route{Method: http.MethodGet, Path: ManagerPrefix + "/accounts/{id}"}
	ManagerAccountProfile         = Route{Method: http.MethodPatch, Path: ManagerPrefix + "/accounts/{id}/profile"}
	ManagerAccountRefresh         = Route{Method: http.MethodPost, Path: ManagerPrefix + "/accounts/{id}/refresh"}
	ManagerAccountLicenseHistory  = Route{Method: http.MethodGet, Path: ManagerPrefix + "/accounts/{id}/license-history"}
	ManagerAccountWidgets         = Route{Method: http.MethodGet, Path: ManagerPrefix + "/accounts/{id}/widgets"}
	ManagerAccountCRMUsers        = Route{Method: http.MethodGet, Path: ManagerPrefix + "/accounts/{id}/crm-users"}
	ManagerAccountRenewal         = Route{Method: http.MethodPost, Path: ManagerPrefix + "/accounts/{id}/renewals"}
	ManagerAccountPortrait        = Route{Method: http.MethodGet, Path: ManagerPrefix + "/accounts/{id}/portrait"}
	ManagerAccountPortraitUpdate  = Route{Method: http.MethodPatch, Path: ManagerPrefix + "/accounts/{id}/portrait"}
	ManagerPortraitAuditDate      = Route{Method: http.MethodPost, Path: ManagerPrefix + "/accounts/{id}/portrait/audit-dates"}
	ManagerPortraitTemplate       = Route{Method: http.MethodGet, Path: ManagerPrefix + "/portrait-template"}
	ManagerPortraitTemplateUpdate = Route{Method: http.MethodPut, Path: ManagerPrefix + "/portrait-template"}
	ManagerPortraitNiches         = Route{Method: http.MethodGet, Path: ManagerPrefix + "/portrait-niches"}
	ManagerPortraitNicheCreate    = Route{Method: http.MethodPost, Path: ManagerPrefix + "/portrait-niches"}
	ManagerPortraitNicheUpdate    = Route{Method: http.MethodPatch, Path: ManagerPrefix + "/portrait-niches/{id}"}
	ManagerPortraitNicheDelete    = Route{Method: http.MethodDelete, Path: ManagerPrefix + "/portrait-niches/{id}"}
	ManagerPortraitNicheMerge     = Route{Method: http.MethodPost, Path: ManagerPrefix + "/portrait-niches/{id}/merge"}
	ManagerProducts               = Route{Method: http.MethodGet, Path: ManagerPrefix + "/products"}
	ManagerProductCreate          = Route{Method: http.MethodPost, Path: ManagerPrefix + "/products"}
	ManagerProduct                = Route{Method: http.MethodGet, Path: ManagerPrefix + "/products/{id}"}
	ManagerProductUpdate          = Route{Method: http.MethodPatch, Path: ManagerPrefix + "/products/{id}"}
	ManagerProductMetrics         = Route{Method: http.MethodGet, Path: ManagerPrefix + "/products/{id}/metrics"}
	ManagerMe                     = Route{Method: http.MethodGet, Path: ManagerPrefix + "/me"}
	ConnectionCommand             = Route{Method: "POST", Path: "/api/v1/connections/{backend}/{connection_id}/commands/{command}"}
	IntegrationCreateCommand      = Route{Method: "POST", Path: "/api/v1/integrations/{backend}/commands/create"}
	IntegrationCommand            = Route{Method: "POST", Path: "/api/v1/integrations/{backend}/{integration_id}/commands/{command}"}
	JobRetry                      = Route{Method: "POST", Path: "/api/v1/operations/jobs/{backend}/{job_id}/retry"}
	DeliveryRetry                 = Route{Method: "POST", Path: "/api/v1/connections/{backend}/{connection_id}/deliveries/{delivery_id}/retry"}
	AdminOperations               = Route{Method: "GET", Path: "/api/v1/operations/admin"}
	AdminOperation                = Route{Method: "GET", Path: "/api/v1/operations/admin/{id}"}
	AuthLogin                     = Route{Method: http.MethodPost, Path: "/api/v1/auth/login"}
	AuthLogout                    = Route{Method: http.MethodPost, Path: "/api/v1/auth/logout"}
	Me                            = Route{Method: http.MethodGet, Path: "/api/v1/me"}
	MeSessions                    = Route{Method: http.MethodGet, Path: "/api/v1/me/sessions"}
	MeSessionRevoke               = Route{Method: http.MethodDelete, Path: "/api/v1/me/sessions/{id}"}
	SystemEmployees               = Route{Method: http.MethodGet, Path: "/api/v1/system/employees"}
	SystemEmployeesCreate         = Route{Method: http.MethodPost, Path: "/api/v1/system/employees"}
	SystemEmployee                = Route{Method: http.MethodPatch, Path: "/api/v1/system/employees/{id}"}
	SystemEmployeeRevoke          = Route{Method: http.MethodPost, Path: "/api/v1/system/employees/{id}/sessions/revoke"}
	SystemAudit                   = Route{Method: http.MethodGet, Path: "/api/v1/system/audit"}
	Accounts                      = Route{Method: http.MethodGet, Path: "/api/v1/accounts"}
	Account                       = Route{Method: http.MethodGet, Path: "/api/v1/accounts/{account_id}"}
	AccountSubscription           = Route{Method: http.MethodGet, Path: "/api/v1/accounts/{account_id}/subscription"}
	AccountCRMUsers               = Route{Method: http.MethodGet, Path: "/api/v1/accounts/{account_id}/crm-users"}
	AccountJobs                   = Route{Method: http.MethodGet, Path: "/api/v1/accounts/{account_id}/jobs"}
	AccountHistory                = Route{Method: http.MethodGet, Path: "/api/v1/accounts/{account_id}/history"}
	Connection                    = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}"}
	ConnectionJobs                = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/jobs"}
	ConnectionAudit               = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/audit"}
	Catalog                       = Route{Method: http.MethodGet, Path: "/api/v1/catalog"}
	Integrations                  = Route{Method: http.MethodGet, Path: "/api/v1/integrations"}
	Integration                   = Route{Method: http.MethodGet, Path: "/api/v1/integrations/{backend}/{integration_id}"}
	OperationsJobs                = Route{Method: http.MethodGet, Path: "/api/v1/operations/jobs"}
	OperationsJob                 = Route{Method: http.MethodGet, Path: "/api/v1/operations/jobs/{backend}/{job_id}"}
	SystemBackends                = Route{Method: http.MethodGet, Path: "/api/v1/system/backends"}
	ActivitySettings              = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/activity/settings"}
	ActivityStatus                = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/activity/status"}
	ActivityPanels                = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/activity/panels"}
	ActivityPanel                 = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/activity/panels/{panel_id}"}
	ActivityEmployees             = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/activity/employees"}
	LeadStatusRules               = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/lead-status/rules"}
	LeadStatusRuns                = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/lead-status/runs"}
	Stats                         = Route{Method: http.MethodGet, Path: "/api/v1/stats"}
	StatsAccounts                 = Route{Method: http.MethodGet, Path: "/api/v1/stats/accounts"}
	Views                         = Route{Method: http.MethodGet, Path: "/api/v1/views"}
	ViewsCreate                   = Route{Method: http.MethodPost, Path: "/api/v1/views"}
	ViewPatch                     = Route{Method: http.MethodPatch, Path: "/api/v1/views/{id}"}
	ViewDelete                    = Route{Method: http.MethodDelete, Path: "/api/v1/views/{id}"}

	Distribution      = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/distribution"}
	DistributionTrace = Route{Method: http.MethodGet, Path: "/api/v1/connections/{backend}/{connection_id}/distribution/trace"}
	Routes            = []Route{
		ManagerLogin, ManagerLogout, ManagerMe, ManagerOperation, ManagerInstallations, ManagerReview,
		ManagerAccounts,
		ManagerAccountSearch,
		ManagerAccount,
		ManagerAccountProfile,
		ManagerAccountRefresh,
		ManagerAccountLicenseHistory,
		ManagerAccountWidgets,
		ManagerAccountCRMUsers,
		ManagerAccountRenewal,
		ManagerAccountPortrait,
		ManagerAccountPortraitUpdate,
		ManagerPortraitAuditDate,
		ManagerPortraitTemplate,
		ManagerPortraitTemplateUpdate,
		ManagerPortraitNiches,
		ManagerPortraitNicheCreate,
		ManagerPortraitNicheUpdate,
		ManagerPortraitNicheDelete,
		ManagerPortraitNicheMerge,
		ManagerProducts, ManagerProductCreate, ManagerProduct, ManagerProductUpdate, ManagerProductMetrics,
		Distribution, DistributionTrace,
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
		AccountSubscription,
		AccountCRMUsers,
		Connection,
		ConnectionJobs,
		ConnectionAudit,
		Catalog,
		Integrations,
		Integration,
		OperationsJobs,
		OperationsJob,
		SystemBackends,
		ActivitySettings,
		ActivityStatus,
		ActivityPanels,
		ActivityPanel,
		ActivityEmployees,
		LeadStatusRules,
		LeadStatusRuns,
		Stats,
		StatsAccounts,
		Views,
		ViewsCreate,
		ViewPatch,
		ViewDelete,
	}
)
