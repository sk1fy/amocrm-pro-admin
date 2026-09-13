package operations

import (
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"testing"
)

func TestCommandPermissionMatrix(t *testing.T) {
	for _, target := range []string{"installation", "integration", "job", "delivery"} {
		for _, cmd := range []string{"create", "update", "rotate-secret", "set-service", "enable", "disable", "revoke", "uninstall", "reconcile", "check", "pilot-enable", "pilot-disable", "retry", "activity-configure", "activity-sync", "activity-panel-create", "activity-panel-patch", "activity-panel-rotate", "lead-status-configure"} {
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

func TestSafeResultKeepsActivityFieldsAndDropsSecrets(t *testing.T) {
	got := safeResult(adapter.CommandResult{Result: map[string]any{
		"initial_days": 2, "retention_days": 7, "updated_at": float64(1),
		"employee_ids": []any{float64(501), float64(502)}, "panel_id": "panel-one",
		"view_key": "secret-view", "share_url": "https://example.invalid/secret",
	}})
	if got["initial_days"] != 2 || got["retention_days"] != 7 || got["panel_id"] != "panel-one" {
		t.Fatalf("got=%v", got)
	}
	ids, _ := got["employee_ids"].([]any)
	if len(ids) != 2 {
		t.Fatalf("employee_ids=%v", got["employee_ids"])
	}
	if _, ok := got["view_key"]; ok {
		t.Fatal("view_key leaked")
	}
	if _, ok := got["share_url"]; ok {
		t.Fatal("share_url leaked")
	}
}
