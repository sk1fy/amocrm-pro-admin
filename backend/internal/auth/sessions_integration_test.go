package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestLoginLogoutAndDisableRevoke(t *testing.T) {
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
		Email: "ops@example.invalid", Name: "Ops", Role: rbac.RoleOperator, PasswordHash: hash,
	})
	if err != nil {
		t.Fatal(err)
	}

	token, account, err := sessions.Login(ctx, emp.Email, "correct-horse-battery", "127.0.0.1", "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	if account.ID != emp.ID || token == "" {
		t.Fatalf("login account=%+v", account)
	}
	principal, err := sessions.Lookup(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if err := sessions.Revoke(ctx, principal.SessionID, auth.ReasonLogout); err != nil {
		t.Fatal(err)
	}
	if _, err := sessions.Lookup(ctx, token); err == nil {
		t.Fatal("expected revoked session to fail lookup")
	}

	token, _, err = sessions.Login(ctx, emp.Email, "correct-horse-battery", "127.0.0.1", "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	status := auth.StatusDisabled
	if _, _, _, err := store.Update(ctx, emp.ID, employees.UpdateInput{Status: &status}); err != nil {
		t.Fatal(err)
	}
	if err := sessions.RevokeAll(ctx, emp.ID, auth.ReasonDisabled); err != nil {
		t.Fatal(err)
	}
	if _, err := sessions.Lookup(ctx, token); err == nil {
		t.Fatal("expected disabled sessions to be revoked")
	}
	if _, _, err := sessions.Login(ctx, emp.Email, "correct-horse-battery", "127.0.0.1", "test-agent"); err == nil {
		t.Fatal("disabled employee must not log in")
	}
}
