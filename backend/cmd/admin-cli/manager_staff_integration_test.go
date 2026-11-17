package main

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestManagerStaffCLIDisableRacesManagerRevoke(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := context.Background()
	t.Setenv("DATABASE_URL", os.Getenv("TEST_DATABASE_URL"))
	store := employees.NewStore(pool, 5*time.Second)
	manager := auth.NewManagerService(pool, 5*time.Second, 12*time.Hour, 2*time.Hour, false)
	access := employees.NewAccess(store, manager, audit.NewStore(pool, 5*time.Second))
	hash, _ := auth.Hash("fixture-password")
	first, err := store.Create(ctx, employees.CreateInput{Email: "first@example.invalid", Name: "First", Role: rbac.RoleAdmin, PasswordHash: hash})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Create(ctx, employees.CreateInput{Email: "second@example.invalid", Name: "Second", Role: rbac.RoleAdmin, PasswordHash: hash})
	if err != nil {
		t.Fatal(err)
	}
	if err := access.BootstrapManager(ctx, first.Email, audit.Event{}); err != nil {
		t.Fatal(err)
	}
	token, _, err := manager.Login(ctx, first.Email, "fixture-password", "127.0.0.1", "")
	if err != nil {
		t.Fatal(err)
	}
	actor, err := manager.Lookup(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	target, err := access.ManagerStaffGet(ctx, actor.SessionID, second.ID)
	if err != nil {
		t.Fatal(err)
	}
	result, _, err := access.ManagerStaffCommand(ctx, employees.StaffCommand{SessionID: actor.SessionID, CommandID: uuid.New(), Kind: "grants", TargetID: second.ID, Version: target.Version, Grants: auth.ManagerAdminGrants()})
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	done := make(chan error, 2)
	go func() {
		<-start
		done <- run([]string{"employee", "disable", "--email", first.Email}, strings.NewReader(""), io.Discard)
	}()
	go func() {
		<-start
		_, _, err := access.ManagerStaffCommand(ctx, employees.StaffCommand{SessionID: actor.SessionID, CommandID: uuid.New(), Kind: "grants", TargetID: second.ID, Version: result.Staff.Version, Grants: []auth.ManagerGrant{}})
		done <- err
	}()
	close(start)
	successes := 0
	for range 2 {
		err := <-done
		if err == nil {
			successes++
		} else if !errors.Is(err, employees.ErrLastManagerAdmin) && !errors.Is(err, auth.ErrUnauthenticated) {
			t.Fatal(err)
		}
	}
	if successes != 1 {
		t.Fatalf("successful disabling operations %d", successes)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM employees e JOIN manager_grants g ON g.employee_id=e.id WHERE e.status='active' AND e.password_hash IS NOT NULL AND g.grant_code='staff.manage'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("active manager administrators %d %v", count, err)
	}
}
