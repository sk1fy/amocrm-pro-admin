package migrations_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestManagerStaffDowngradeGuards(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := t.Context()
	down, err := os.ReadFile(filepath.Join(testkit.MigrationsDir(t), "000011_manager_staff.down.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"manager-only", "invitation", "receipt"} {
		t.Run(kind, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = tx.Rollback(ctx) }()
			id := uuid.New()
			if _, err := tx.Exec(ctx, `INSERT INTO employees(id,email,name,role,technical_access)VALUES($1,'downgrade@example.invalid','Downgrade','viewer',$2)`, id, kind != "manager-only"); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "invitation":
				_, err = tx.Exec(ctx, `INSERT INTO manager_invitations(employee_id,token_hash,expires_at,created_by)VALUES($1,decode(repeat('ab',32),'hex'),now()+interval '1 hour',$1)`, id)
			case "receipt":
				_, err = tx.Exec(ctx, `INSERT INTO manager_staff_receipts(actor_id,command_id,request_hash,result)VALUES($1,$2,decode(repeat('ab',32),'hex'),'{}')`, id, uuid.New())
			}
			if err != nil {
				t.Fatal(err)
			}
			attempt, err := tx.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := attempt.Exec(ctx, string(down)); err == nil {
				t.Fatal("unsafe downgrade accepted")
			}
			if err := attempt.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
			var intact bool
			if err := tx.QueryRow(ctx, `SELECT technical_access=$2 FROM employees WHERE id=$1`, id, kind != "manager-only").Scan(&intact); err != nil || !intact {
				t.Fatalf("rejected downgrade changed identity %v", err)
			}
		})
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, string(down)); err != nil {
		t.Fatalf("empty safe downgrade failed %v", err)
	}
}
