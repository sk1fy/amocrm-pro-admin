package operations

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestPruneTerminalBeforeDeletesOnlyTerminalOutsideWindow(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := context.Background()
	employee, err := employees.NewStore(pool, 2*time.Second).Create(ctx, employees.CreateInput{
		Email: "operations-retention@example.invalid", Name: "Operations Retention", Role: rbac.RoleAdmin, PasswordHash: "unused",
	})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	insert := func(state string, at time.Time) uuid.UUID {
		t.Helper()
		id := uuid.New()
		if _, err := pool.Exec(ctx, `
			INSERT INTO operations (
				id, employee_id, actor_email, request_id, backend, target_type, target_id,
				command, idempotency_key, request_hash, state, lease_until, created_at, updated_at
			) VALUES ($1,$2,$3,$4,'core','installation',$5,'disable',$6,$7,$8,$9,$9,$9)`,
			id, employee.ID, employee.Email, uuid.New(), id.String(), id.String(),
			make([]byte, 32), state, at,
		); err != nil {
			t.Fatal(err)
		}
		return id
	}
	old := now.Add(-200 * 24 * time.Hour)
	oldTerminal := map[uuid.UUID]bool{}
	oldTerminal[insert("succeeded", old)] = true
	oldTerminal[insert("failed", old)] = true
	oldTerminal[insert("partial", old)] = true
	oldTerminal[insert("unknown_outcome", old)] = true
	newTerminal := insert("succeeded", now.Add(-10*24*time.Hour))
	oldRunning := insert("running", old)
	oldPending := insert("pending", old)

	cutoff := now.Add(-180 * 24 * time.Hour)
	store := NewStore(pool, 2*time.Second, nil)
	matched, err := store.CountTerminalBefore(ctx, cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if matched != int64(len(oldTerminal)) {
		t.Fatalf("matched = %d, want %d", matched, len(oldTerminal))
	}
	deleted, err := store.PruneTerminalBefore(ctx, cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != int64(len(oldTerminal)) {
		t.Fatalf("deleted = %d, want %d", deleted, len(oldTerminal))
	}
	rows, err := pool.Query(ctx, `SELECT id, state FROM operations`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	remaining := map[uuid.UUID]string{}
	for rows.Next() {
		var id uuid.UUID
		var state string
		if err := rows.Scan(&id, &state); err != nil {
			t.Fatal(err)
		}
		remaining[id] = state
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 3 {
		t.Fatalf("remaining = %d, want 3: %v", len(remaining), remaining)
	}
	for id := range oldTerminal {
		if _, exists := remaining[id]; exists {
			t.Fatalf("old terminal operation %s survived", id)
		}
	}
	if remaining[newTerminal] != "succeeded" {
		t.Fatalf("new terminal operation missing: %v", remaining)
	}
	if remaining[oldRunning] != "running" {
		t.Fatalf("running operation missing: %v", remaining)
	}
	if remaining[oldPending] != "pending" {
		t.Fatalf("pending operation missing: %v", remaining)
	}
}
