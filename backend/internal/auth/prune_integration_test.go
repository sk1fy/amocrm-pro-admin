package auth_test

import (
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestPruneExpiredBeforeDeletesOnlyStaleSessions(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := context.Background()
	employee, err := employees.NewStore(pool, 2*time.Second).Create(ctx, employees.CreateInput{
		Email: "session-retention@example.invalid", Name: "Session Retention", Role: rbac.RoleAdmin, PasswordHash: "unused",
	})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	insert := func(createdAt, expiresAt time.Time, revokedAt *time.Time, reason *string) uuid.UUID {
		t.Helper()
		id := uuid.New()
		tokenHash := sha256.Sum256(id[:])
		if _, err := pool.Exec(ctx, `
			INSERT INTO sessions (id, employee_id, token_hash, created_at, last_seen_at, expires_at, revoked_at, revoke_reason)
			VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
			id, employee.ID, tokenHash[:], createdAt, expiresAt, revokedAt, reason,
		); err != nil {
			t.Fatal(err)
		}
		return id
	}
	revokedAt := now.Add(-45 * 24 * time.Hour)
	revokedReason := auth.ReasonLogout
	expiredOld := insert(now.Add(-60*24*time.Hour), now.Add(-40*24*time.Hour), nil, nil)
	revokedOld := insert(now.Add(-60*24*time.Hour), now.Add(-50*24*time.Hour), &revokedAt, &revokedReason)
	active := insert(now.Add(-time.Hour), now.Add(11*time.Hour), nil, nil)
	expiredRecent := insert(now.Add(-40*24*time.Hour), now.Add(-10*24*time.Hour), nil, nil)
	recentRevokedAt := now.Add(-time.Hour)
	recentReason := auth.ReasonLogout
	revokedRecent := insert(now.Add(-3*time.Hour), now.Add(9*time.Hour), &recentRevokedAt, &recentReason)

	cutoff := now.Add(-30 * 24 * time.Hour)
	sessions := auth.NewService(pool, 2*time.Second, 12*time.Hour, 2*time.Hour, false)
	matched, err := sessions.CountExpiredBefore(ctx, cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if matched != 2 {
		t.Fatalf("matched = %d, want 2", matched)
	}
	deleted, err := sessions.PruneExpiredBefore(ctx, cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 2 {
		t.Fatalf("deleted = %d, want 2", deleted)
	}
	rows, err := pool.Query(ctx, `SELECT id FROM sessions`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	survivors := map[uuid.UUID]bool{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		survivors[id] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for _, stale := range []uuid.UUID{expiredOld, revokedOld} {
		if survivors[stale] {
			t.Fatalf("stale session %s survived", stale)
		}
	}
	for _, kept := range []uuid.UUID{active, expiredRecent, revokedRecent} {
		if !survivors[kept] {
			t.Fatalf("session %s was deleted", kept)
		}
	}
}
