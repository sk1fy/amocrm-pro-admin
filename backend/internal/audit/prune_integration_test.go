package audit_test

import (
	"context"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestPruneBeforeDeletesOnlyAuditOutsideWindow(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := context.Background()
	employee, err := employees.NewStore(pool, 2*time.Second).Create(ctx, employees.CreateInput{
		Email: "audit-retention@example.invalid", Name: "Audit Retention", Role: rbac.RoleAdmin, PasswordHash: "unused",
	})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	insert := func(at time.Time) int64 {
		t.Helper()
		var id int64
		if err := pool.QueryRow(ctx, `
			INSERT INTO admin_audit_log (employee_id, action, object_type, object_ref, created_at)
			VALUES ($1, 'employee.update', 'employee', $2, $3)
			RETURNING id`, employee.ID, "employee:"+employee.ID.String(), at).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	oldID := insert(now.Add(-400 * 24 * time.Hour))
	newID := insert(now.Add(-30 * 24 * time.Hour))
	cutoff := now.Add(-365 * 24 * time.Hour)
	store := audit.NewStore(pool, 2*time.Second)

	matched, err := store.CountBefore(ctx, cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if matched != 1 {
		t.Fatalf("matched = %d, want 1", matched)
	}
	deleted, err := store.PruneBefore(ctx, cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}
	var survivorID int64
	if err := pool.QueryRow(ctx, `SELECT id FROM admin_audit_log`).Scan(&survivorID); err != nil {
		t.Fatal(err)
	}
	if survivorID != newID {
		t.Fatalf("survivor = %d, want %d (old %d)", survivorID, newID, oldID)
	}
}
