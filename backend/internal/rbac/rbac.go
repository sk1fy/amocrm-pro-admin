package rbac

import (
	"context"
	"net/http"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

const (
	RoleViewer   = "viewer"
	RoleOperator = "operator"
	RoleAdmin    = "admin"

	AccountsRead             = "accounts:read"
	ConnectionsRead          = "connections:read"
	IntegrationsRead         = "integrations:read"
	OperationsRead           = "operations:read"
	SystemRead               = "system:read"
	AuditRead                = "audit:read"
	SessionsSelf             = "sessions:self"
	EmployeesRead            = "employees:read"
	EmployeesWrite           = "employees:write"
	ConnectionsCheck         = "connections:check"
	ConnectionsEnable        = "connections:enable"
	ConnectionsDisable       = "connections:disable"
	ConnectionsRevoke        = "connections:revoke"
	ConnectionsUninstall     = "connections:uninstall"
	WebhooksReconcile        = "webhooks:reconcile"
	OperationsRetry          = "operations:retry"
	IntegrationsWrite        = "integrations:write"
	IntegrationsRotateSecret = "integrations:rotate_secret"
	IntegrationsEnable       = "integrations:enable"
	IntegrationsDisable      = "integrations:disable"
	ActivitySettingsWrite    = "activity:settings:write"
	ActivitySync             = "activity:sync"
	ActivityPanelsWrite      = "activity:panels:write"
	ActivityPilot            = "activity:pilot"
	LeadStatusRulesWrite     = "leadstatus:rules:write"
	StatsRead                = "stats:read"
	ViewsWrite               = "views:write"
)

var AllPermissions = []string{
	AccountsRead,
	ConnectionsRead,
	IntegrationsRead,
	OperationsRead,
	SystemRead,
	AuditRead,
	SessionsSelf,
	EmployeesRead,
	EmployeesWrite,
	ConnectionsCheck,
	ConnectionsEnable,
	ConnectionsDisable,
	ConnectionsRevoke,
	ConnectionsUninstall,
	WebhooksReconcile,
	OperationsRetry,
	IntegrationsWrite,
	IntegrationsRotateSecret,
	IntegrationsEnable,
	IntegrationsDisable,
	ActivitySettingsWrite,
	ActivitySync,
	ActivityPanelsWrite,
	ActivityPilot,
	LeadStatusRulesWrite,
	StatsRead,
	ViewsWrite,
}

var matrix = map[string]map[string]bool{
	RoleViewer: {
		AccountsRead: true, ConnectionsRead: true, IntegrationsRead: true, OperationsRead: true,
		SystemRead: true, AuditRead: true, SessionsSelf: true, StatsRead: true,
	},
	RoleOperator: {
		AccountsRead: true, ConnectionsRead: true, IntegrationsRead: true, OperationsRead: true,
		SystemRead: true, AuditRead: true, SessionsSelf: true,
		ConnectionsCheck: true, ConnectionsEnable: true, ConnectionsDisable: true, ConnectionsRevoke: true,
		WebhooksReconcile: true, OperationsRetry: true,
		ActivitySettingsWrite: true, ActivitySync: true, ActivityPanelsWrite: true, ActivityPilot: true,
		LeadStatusRulesWrite: true, StatsRead: true, ViewsWrite: true,
	},
	RoleAdmin: permissionSet(AllPermissions),
}

type employeeLookup interface {
	Get(ctx context.Context, id uuid.UUID) (Employee, error)
}

type Employee struct {
	ID     uuid.UUID
	Email  string
	Name   string
	Role   string
	Status string
}

type employeeKey struct{}

func EmployeeFromContext(ctx context.Context) (Employee, bool) {
	emp, ok := ctx.Value(employeeKey{}).(Employee)
	return emp, ok
}

func Allows(role, permission string) bool {
	return matrix[role][permission]
}

func Permissions(role string) []string {
	granted := make([]string, 0, len(AllPermissions))
	for _, permission := range AllPermissions {
		if Allows(role, permission) {
			granted = append(granted, permission)
		}
	}
	return granted
}

func ValidRole(role string) bool {
	_, ok := matrix[role]
	return ok
}

func Require(permission string, lookup employeeLookup) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal, ok := auth.PrincipalFromContext(r.Context())
			if !ok {
				httpx.WriteError(w, r, httpx.Unauthenticated("authentication required"))
				return
			}
			emp, err := lookup.Get(r.Context(), principal.EmployeeID)
			if err != nil || emp.Status != auth.StatusActive {
				httpx.WriteError(w, r, httpx.Unauthenticated("authentication required"))
				return
			}
			if !Allows(emp.Role, permission) {
				httpx.WriteError(w, r, httpx.Forbidden("insufficient permissions"))
				return
			}
			ctx := context.WithValue(r.Context(), employeeKey{}, emp)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func permissionSet(items []string) map[string]bool {
	set := make(map[string]bool, len(items))
	for _, item := range items {
		set[item] = true
	}
	return set
}
