package migrations_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
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
	testkit.Reset(t, pool)
	assertAppTables(t, pool, true)
	if count := migrationCount(t, pool); count != 11 {
		t.Fatalf("applied = %d, want 11", count)
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
	if count := migrationCount(t, pool); count != 11 {
		t.Fatalf("parallel up applied = %d, want 11", count)
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
	var employees, sessions, audit, grants, intents *string
	if err := pool.QueryRow(ctx, `
		SELECT to_regclass('public.employees')::text,
		       to_regclass('public.sessions')::text,
		       to_regclass('public.admin_audit_log')::text,
		       to_regclass('public.manager_grants')::text,
		       to_regclass('public.manager_command_intents')::text`).Scan(&employees, &sessions, &audit, &grants, &intents); err != nil {
		t.Fatal(err)
	}
	for name, table := range map[string]*string{
		"employees": employees, "sessions": sessions, "admin_audit_log": audit,
		"manager_grants": grants, "manager_command_intents": intents,
	} {
		if present := table != nil; present != wantPresent {
			t.Errorf("table %s present=%t, want %t", name, present, wantPresent)
		}
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

func TestManagerAudiencePreservesLegacySession(t *testing.T) {
	pool := testkit.Postgres(t)
	dir := testkit.MigrationsDir(t)
	runner := migrations.New(pool, dir)
	t.Cleanup(func() {
		if err := runner.Up(context.Background()); err != nil {
			t.Errorf("restore migrations: %v", err)
		}
	})
	ctx := t.Context()
	testkit.Reset(t, pool)
	if err := runner.Down(ctx); err != nil {
		t.Fatal(err)
	}

	legacyDir := t.TempDir()
	files, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		name := file.Name()
		if !strings.HasSuffix(name, ".sql") || name >= "000007_" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(legacyDir, name), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := migrations.New(pool, legacyDir).Up(ctx); err != nil {
		t.Fatal(err)
	}
	token, hash, err := auth.NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		WITH employee AS (
			INSERT INTO employees (email, name, role)
			VALUES ('legacy@example.invalid', 'Legacy employee', 'viewer')
			RETURNING id
		)
		INSERT INTO sessions (employee_id, token_hash, expires_at)
		SELECT id, $1, now() + interval '1 hour' FROM employee`, hash); err != nil {
		t.Fatal(err)
	}
	if err := runner.Up(ctx); err != nil {
		t.Fatal(err)
	}
	core := auth.NewService(pool, time.Second, time.Hour, time.Hour, false)
	if principal, err := core.Lookup(ctx, token); err != nil || principal.Audience != auth.CoreAdmin {
		t.Fatalf("legacy token audience = %q, err = %v", principal.Audience, err)
	}
	manager := auth.NewManagerService(pool, time.Second, time.Hour, time.Hour, false)
	if _, err := manager.Lookup(ctx, token); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("legacy token accepted on manager audience: %v", err)
	}
}
