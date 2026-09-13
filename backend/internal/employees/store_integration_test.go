package employees_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestCreateConflictAndRoleChange(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := context.Background()
	store := employees.NewStore(pool, 2*time.Second)
	sessions := auth.NewService(pool, 2*time.Second, 12*time.Hour, 2*time.Hour, false)

	hash, err := auth.Hash("correct-horse-battery")
	if err != nil {
		t.Fatal(err)
	}
	emp, err := store.Create(ctx, employees.CreateInput{
		Email: "lead@example.invalid", Name: "Lead", Role: rbac.RoleViewer, PasswordHash: hash,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(ctx, employees.CreateInput{
		Email: emp.Email, Name: "Lead", Role: rbac.RoleViewer, PasswordHash: hash,
	}); !errors.Is(err, employees.ErrConflict) {
		t.Fatalf("error = %v, want conflict", err)
	}

	token, _, err := sessions.Login(ctx, emp.Email, "correct-horse-battery", "127.0.0.1", "test")
	if err != nil {
		t.Fatal(err)
	}
	role := rbac.RoleOperator
	updated, roleChanged, _, err := store.Update(ctx, emp.ID, employees.UpdateInput{Role: &role})
	if err != nil || !roleChanged || updated.Role != rbac.RoleOperator {
		t.Fatalf("update = %+v %t %v", updated, roleChanged, err)
	}
	if err := sessions.RevokeAll(ctx, emp.ID, auth.ReasonRoleChange); err != nil {
		t.Fatal(err)
	}
	if _, err := sessions.Lookup(ctx, token); err == nil {
		t.Fatal("expected role change to revoke sessions")
	}
}
