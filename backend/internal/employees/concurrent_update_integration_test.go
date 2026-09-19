package employees_test

import (
	"context"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestRenameCannotUndoConcurrentAccessChange(t *testing.T) {
	for _, change := range []string{"status", "role"} {
		t.Run(change, func(t *testing.T) {
			pool := testkit.Postgres(t)
			testkit.Reset(t, pool)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			store := employees.NewStore(pool, 8*time.Second)
			emp, err := store.Create(ctx, employees.CreateInput{Email: "race@example.invalid", Name: "Before", Role: rbac.RoleAdmin, PasswordHash: "unused"})
			if err != nil {
				t.Fatal(err)
			}
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = tx.Rollback(ctx) }()
			if _, err := tx.Exec(ctx, "SELECT id FROM employees WHERE id=$1 FOR UPDATE", emp.ID); err != nil {
				t.Fatal(err)
			}
			var blocker int32
			if err := tx.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&blocker); err != nil {
				t.Fatal(err)
			}
			type result struct {
				emp          employees.Employee
				role, status bool
				err          error
			}
			done := make(chan result, 1)
			go func() {
				name := "Renamed"
				updated, role, status, err := store.Update(ctx, emp.ID, employees.UpdateInput{Name: &name})
				done <- result{updated, role, status, err}
			}()
			// Observe the competing SQL waiting on our row lock, not a timing guess.
			for {
				var waiting bool
				if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)))`, blocker).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting {
					break
				}
				select {
				case got := <-done:
					t.Fatalf("update did not wait for row lock: %+v", got)
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-time.After(5 * time.Millisecond):
				}
			}
			if change == "status" {
				_, err = tx.Exec(ctx, "UPDATE employees SET status='disabled' WHERE id=$1", emp.ID)
			} else {
				_, err = tx.Exec(ctx, "UPDATE employees SET role='viewer' WHERE id=$1", emp.ID)
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			got := <-done
			if got.err != nil || got.emp.Name != "Renamed" || got.role || got.status {
				t.Fatalf("rename result: %+v", got)
			}
			if change == "status" && got.emp.Status != auth.StatusDisabled {
				t.Fatal("rename undid disabling")
			}
			if change == "role" && got.emp.Role != rbac.RoleViewer {
				t.Fatal("rename undid demotion")
			}
		})
	}
}
