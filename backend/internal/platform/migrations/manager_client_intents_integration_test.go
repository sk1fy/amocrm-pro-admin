package migrations_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestManagerClientIntentsRollbackPreservesCommands(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := t.Context()
	down, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000009_manager_client_intents.down.sql"))
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = legacy.Rollback(ctx) }()
	employee, review, refresh, target := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	if _, err := legacy.Exec(ctx, `INSERT INTO employees(id,email,name,role)
		VALUES($1,'old-intent@example.invalid','Old Intent','viewer')`, employee); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(ctx, `INSERT INTO manager_command_intents
		(id,employee_id,session_id,idempotency_key,kind,target_id,expected_version,body_hash)
		VALUES($1,$2,$3,$4,'installation.review',$5,41,decode(repeat('2b',32),'hex'))`,
		review, employee, uuid.New(), uuid.New(), target); err != nil {
		t.Fatal(err)
	}
	withNewKind, err := legacy.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := withNewKind.Exec(ctx, `INSERT INTO manager_command_intents
		(id,employee_id,session_id,idempotency_key,kind,target_id,body_hash)
		VALUES($1,$2,$3,$4,'account.refresh',$5,decode(repeat('3a',32),'hex'))`,
		refresh, employee, uuid.New(), uuid.New(), target); err != nil {
		t.Fatal(err)
	}
	attempt, err := withNewKind.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = attempt.Exec(ctx, string(down))
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) || pgError.Code != "55000" ||
		pgError.Message != "cannot revert migration 000009 while manager client intents exist" || pgError.Hint == "" {
		t.Fatalf("rollback used the wrong failure: %v", err)
	}
	if err := attempt.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	var newIntact bool
	if err := withNewKind.QueryRow(ctx, `SELECT kind='account.refresh' AND expected_version IS NULL AND related_id IS NULL
		AND body_hash=decode(repeat('3a',32),'hex') FROM manager_command_intents WHERE id=$1`, refresh).Scan(&newIntact); err != nil || !newIntact {
		t.Fatalf("rejected rollback altered the new command: %t %v", newIntact, err)
	}
	if err := withNewKind.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(ctx, string(down)); err != nil {
		t.Fatalf("legacy-only rollback failed: %v", err)
	}
	var version int64
	var hash string
	var observedTarget uuid.UUID
	if err := legacy.QueryRow(ctx, `SELECT expected_version,encode(body_hash,'hex'),target_id
		FROM manager_command_intents WHERE id=$1 AND kind='installation.review'`, review).
		Scan(&version, &hash, &observedTarget); err != nil || version != 41 || hash != strings.Repeat("2b", 32) || observedTarget != target {
		t.Fatalf("legacy command changed on rollback: version=%d target=%s error=%v", version, observedTarget, err)
	}
}
