package audit_test

import (
	"context"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestRecordAndListAudit(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := context.Background()
	store := employees.NewStore(pool, 2*time.Second)
	audits := audit.NewStore(pool, 2*time.Second)

	hash, err := auth.Hash("correct-horse-battery")
	if err != nil {
		t.Fatal(err)
	}
	emp, err := store.Create(ctx, employees.CreateInput{
		Email: "auditor@example.invalid", Name: "Auditor", Role: rbac.RoleAdmin, PasswordHash: hash,
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := audits.Record(ctx, audit.Event{
		Metadata: map[string]any{"password": "nope"},
	}); err == nil {
		t.Fatal("expected forbidden metadata")
	}

	if err := audits.Record(ctx, audit.Event{
		EmployeeID: &emp.ID,
		ActorEmail: emp.Email,
		Action:     audit.ActionLogin,
		IP:         "127.0.0.1",
	}); err != nil {
		t.Fatal(err)
	}
	if err := audits.Record(ctx, audit.Event{
		ActorEmail: "missing@example.invalid",
		Action:     audit.ActionLoginFailed,
		Outcome:    audit.OutcomeDenied,
		IP:         "127.0.0.1",
	}); err != nil {
		t.Fatal(err)
	}
	if err := audits.Record(ctx, audit.Event{
		EmployeeID: &emp.ID,
		ActorEmail: emp.Email,
		Action:     audit.ActionEmployeeCreate,
		ObjectType: "employee",
		ObjectRef:  "employee:" + emp.ID.String(),
		Metadata:   map[string]any{"email": emp.Email, "role": emp.Role},
	}); err != nil {
		t.Fatal(err)
	}

	items, _, total, err := audits.List(ctx, audit.ListFilter{Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	if total != 3 || len(items) != 3 {
		t.Fatalf("total=%d items=%d", total, len(items))
	}
}
