package managerplatform

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

type intent struct {
	ID, EmployeeID, SessionID, Key, TargetID, RelatedID uuid.UUID
	Kind                                                commandKind
	Version                                             int64
	Hash                                                []byte
	Lease                                               uuid.UUID
}

type store struct {
	pool    *pgxpool.Pool
	audit   *audit.Store
	timeout time.Duration
}

const intentColumns = "id, employee_id, session_id, idempotency_key, target_id, kind, expected_version, body_hash, related_id"

func scanIntent(row pgx.Row) (value intent, err error) {
	var target, related *uuid.UUID
	var version *int64
	err = row.Scan(&value.ID, &value.EmployeeID, &value.SessionID, &value.Key,
		&target, &value.Kind, &version, &value.Hash, &related)
	if target != nil {
		value.TargetID = *target
	}
	if related != nil {
		value.RelatedID = *related
	}
	if version != nil {
		value.Version = *version
	}
	return value, err
}

func nullableManagerID(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}

func (s store) admit(ctx context.Context, actor auth.Principal, proposal intent) (intent, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return intent{}, false, fmt.Errorf("begin manager intent: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	proposal.ID, proposal.Lease = uuid.New(), uuid.New()
	proposal.EmployeeID, proposal.SessionID = actor.EmployeeID, actor.SessionID
	var expectedVersion *int64
	if proposal.Version != 0 {
		expectedVersion = &proposal.Version
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO manager_command_intents (`+intentColumns+`, next_check_at, lease_id, lease_until)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, now() + interval '35 seconds')
		ON CONFLICT (employee_id, idempotency_key) DO NOTHING`,
		proposal.ID, proposal.EmployeeID, proposal.SessionID, proposal.Key,
		nullableManagerID(proposal.TargetID), proposal.Kind, expectedVersion, proposal.Hash, nullableManagerID(proposal.RelatedID), proposal.Lease)
	if err != nil {
		return intent{}, false, fmt.Errorf("insert manager intent: %w", err)
	}
	created := tag.RowsAffected() == 1
	if created {
		objectType := proposal.Kind.policy().target
		objectRef := objectType
		if proposal.TargetID != uuid.Nil {
			objectRef += ":" + proposal.TargetID.String()
		}
		err = s.audit.RecordTx(ctx, tx, audit.Event{
			EmployeeID: &actor.EmployeeID, ActorEmail: actor.Account.Email,
			Action: "manager.command.admitted", ObjectType: objectType, ObjectRef: objectRef,
			RequestID: httpx.RequestIDFromContext(ctx),
			Metadata:  map[string]any{"command_id": proposal.ID, "command": proposal.Kind},
		})
		if err != nil {
			return intent{}, false, fmt.Errorf("audit manager intent: %w", err)
		}
	} else {
		existing, err := scanIntent(tx.QueryRow(ctx, `
			SELECT `+intentColumns+` FROM manager_command_intents
			WHERE employee_id = $1 AND idempotency_key = $2`, actor.EmployeeID, proposal.Key))
		if err != nil {
			return intent{}, false, fmt.Errorf("read manager intent by key: %w", err)
		}
		if existing.Kind != proposal.Kind || existing.TargetID != proposal.TargetID || existing.RelatedID != proposal.RelatedID ||
			existing.Version != proposal.Version || !bytes.Equal(existing.Hash, proposal.Hash) {
			return intent{}, false, ErrConflict
		}
		proposal = existing
	}
	if err := tx.Commit(ctx); err != nil {
		return intent{}, false, fmt.Errorf("commit manager intent: %w", err)
	}
	return proposal, created, nil
}

func (s store) owned(ctx context.Context, id, employeeID uuid.UUID) (intent, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	item, err := scanIntent(s.pool.QueryRow(ctx, `
		SELECT `+intentColumns+` FROM manager_command_intents WHERE id = $1 AND employee_id = $2`, id, employeeID))
	if errors.Is(err, pgx.ErrNoRows) {
		return intent{}, ErrNotFound
	}
	if err != nil {
		return intent{}, fmt.Errorf("load owned manager intent: %w", err)
	}
	return item, nil
}

func (s store) claimByID(ctx context.Context, item *intent) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	lease := uuid.New()
	tag, err := s.pool.Exec(ctx, `
		UPDATE manager_command_intents SET lease_id = $2, lease_until = now() + interval '35 seconds'
		WHERE id = $1 AND (lease_until IS NULL OR lease_until <= now())`, item.ID, lease)
	if err != nil {
		return false, fmt.Errorf("lease manager intent: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	item.Lease = lease
	return true, nil
}

func (s store) claimNext(ctx context.Context) (intent, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	lease := uuid.New()
	item, err := scanIntent(s.pool.QueryRow(ctx, `
		UPDATE manager_command_intents SET lease_id = $1, lease_until = now() + interval '35 seconds'
		WHERE id = (
			SELECT id FROM manager_command_intents
			WHERE next_check_at <= now() AND (lease_until IS NULL OR lease_until <= now())
			ORDER BY next_check_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
		) RETURNING `+intentColumns, lease))
	if errors.Is(err, pgx.ErrNoRows) {
		return intent{}, ErrNotFound
	}
	if err != nil {
		return intent{}, fmt.Errorf("lease pending manager intent: %w", err)
	}
	item.Lease = lease
	return item, nil
}

func (s store) finish(ctx context.Context, item intent, delay time.Duration) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.timeout)
	defer cancel()
	_, err := s.pool.Exec(ctx, `
		UPDATE manager_command_intents
		SET lease_id = NULL, lease_until = NULL,
		    next_check_at = CASE WHEN $3::bigint > 0 THEN now() + $3 * interval '1 microsecond' END
		WHERE id = $1 AND lease_id = $2`, item.ID, item.Lease, delay.Microseconds())
	if err != nil {
		return fmt.Errorf("reschedule manager intent: %w", err)
	}
	return nil
}
