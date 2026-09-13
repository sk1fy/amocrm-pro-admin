package migrations_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sk1fy/amocrm-pro-admin/internal/platform/migrations"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestMigratorLifecycle(t *testing.T) {
	pool := testkit.Postgres(t)
	dir := testkit.MigrationsDir(t)
	runner := migrations.New(pool, dir)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	if err := runner.Up(ctx); err != nil {
		t.Fatalf("up: %v", err)
	}
	assertAppTables(t, pool, true)
	if count := migrationCount(t, pool); count != 6 {
		t.Fatalf("applied = %d, want 6", count)
	}

	if err := migrations.RequireDownConfirmation(func(string) string { return "" }); err == nil {
		t.Fatal("unconfirmed down must be rejected")
	}

	if err := runner.Down(ctx); err != nil {
		t.Fatalf("down: %v", err)
	}
	assertAppTables(t, pool, false)

	t.Cleanup(func() {
		upCtx, upCancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer upCancel()
		if err := runner.Up(upCtx); err != nil {
			t.Errorf("restore migrations: %v", err)
		}
	})

	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- runner.Up(ctx)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("parallel up: %v", err)
		}
	}
	if count := migrationCount(t, pool); count != 6 {
		t.Fatalf("parallel up applied = %d, want 6", count)
	}
	assertAppTables(t, pool, true)
	if err := runner.EnsureCurrent(ctx); err != nil {
		t.Fatal(err)
	}
}

func assertAppTables(t *testing.T, pool *pgxpool.Pool, wantPresent bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var employees, sessions, audit *string
	if err := pool.QueryRow(ctx, `
		SELECT to_regclass('public.employees')::text,
		       to_regclass('public.sessions')::text,
		       to_regclass('public.admin_audit_log')::text`).Scan(&employees, &sessions, &audit); err != nil {
		t.Fatal(err)
	}
	present := employees != nil && sessions != nil && audit != nil
	if present != wantPresent {
		t.Fatalf("tables present=%t, want %t (employees=%v sessions=%v audit=%v)", present, wantPresent, employees, sessions, audit)
	}
}

func migrationCount(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}
