package operations

import (
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"testing"
)

func TestCommandPermissionMatrix(t *testing.T) {
	for _, target := range []string{"installation", "integration", "job", "delivery"} {
		for _, cmd := range []string{"create", "update", "rotate-secret", "set-service", "enable", "disable", "revoke", "uninstall", "reconcile", "check", "pilot-enable", "pilot-disable", "retry"} {
			p := Permission(target, cmd)
			if p == "" {
				continue
			}
			if rbac.Allows(rbac.RoleViewer, p) {
				t.Fatalf("viewer granted %s/%s", target, cmd)
			}
			if (target == "integration" || cmd == "uninstall") && rbac.Allows(rbac.RoleOperator, p) {
				t.Fatalf("operator granted %s/%s", target, cmd)
			}
			if !rbac.Allows(rbac.RoleAdmin, p) {
				t.Fatalf("admin missing %s/%s", target, cmd)
			}
		}
	}
}

func TestSafeResultRejectsUnexpectedPayloadData(t *testing.T) {
	got := safeResult(adapter.CommandResult{Result: map[string]any{"status": "active", "client_secret": "must-not-persist", "payload": map[string]any{"private": "value"}, "job_id": map[string]any{"access_token": "also-private"}}})
	if len(got) != 1 || got["status"] != "active" {
		t.Fatalf("unexpected result fields: %v", got)
	}
}
