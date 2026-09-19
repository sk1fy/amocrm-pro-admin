package employees

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
)

// Access commits employee/session changes and their audit record together.
// All stores belong to the same Admin database; no remote calls run here.
type Access struct {
	store    *Store
	sessions *auth.Service
	audit    *audit.Store
}

func NewAccess(store *Store, sessions *auth.Service, auditStore *audit.Store) *Access {
	return &Access{store: store, sessions: sessions, audit: auditStore}
}

func (s *Access) transact(ctx context.Context, apply func(context.Context, pgx.Tx) error) error {
	ctx, cancel := context.WithTimeout(ctx, s.store.timeout)
	defer cancel()
	tx, err := s.store.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin access change: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := apply(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit access change: %w", err)
	}
	return nil
}

func (s *Access) Create(ctx context.Context, in CreateInput, event audit.Event) (Employee, error) {
	var emp Employee
	err := s.transact(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		emp, err = s.store.CreateTx(ctx, tx, in)
		if err != nil {
			return err
		}
		event.Action = audit.ActionEmployeeCreate
		event.ObjectType = "employee"
		event.ObjectRef = "employee:" + emp.ID.String()
		event.Metadata = map[string]any{"email": emp.Email, "role": emp.Role}
		return s.audit.RecordTx(ctx, tx, event)
	})
	if err != nil {
		return Employee{}, err
	}
	return emp, nil
}

func (s *Access) Update(ctx context.Context, id uuid.UUID, in UpdateInput, event audit.Event) (Employee, error) {
	var emp Employee
	err := s.transact(ctx, func(ctx context.Context, tx pgx.Tx) error {
		before, updated, err := s.store.UpdateTx(ctx, tx, id, in)
		if err != nil {
			return err
		}
		emp = updated
		roleChanged, statusChanged := before.Role != emp.Role, before.Status != emp.Status
		event.Action = audit.ActionEmployeeUpdate
		reason := ""
		if statusChanged && emp.Status == auth.StatusDisabled {
			reason = auth.ReasonDisabled
			event.Action = audit.ActionEmployeeDisable
		} else if roleChanged {
			reason = auth.ReasonRoleChange
		}
		if reason != "" {
			if err := s.sessions.RevokeAllTx(ctx, tx, emp.ID, reason); err != nil {
				return err
			}
		}
		changed := make([]string, 0, 3)
		from, to := map[string]any{}, map[string]any{}
		for _, field := range []struct{ name, before, after string }{
			{"name", before.Name, emp.Name}, {"role", before.Role, emp.Role}, {"status", before.Status, emp.Status},
		} {
			if field.before != field.after {
				changed = append(changed, field.name)
				from[field.name], to[field.name] = field.before, field.after
			}
		}
		event.ObjectType, event.ObjectRef = "employee", "employee:"+emp.ID.String()
		event.Metadata = map[string]any{"changed": changed, "from": from, "to": to}
		return s.audit.RecordTx(ctx, tx, event)
	})
	if err != nil {
		return Employee{}, err
	}
	return emp, nil
}

func (s *Access) RevokeAll(ctx context.Context, id uuid.UUID, event audit.Event) error {
	return s.transact(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := s.store.lockRecord(ctx, tx, id); err != nil {
			return err
		}
		if err := s.sessions.RevokeAllTx(ctx, tx, id, auth.ReasonAdmin); err != nil {
			return err
		}
		event.Action, event.ObjectType, event.ObjectRef = audit.ActionSessionsRevoke, "employee", "employee:"+id.String()
		return s.audit.RecordTx(ctx, tx, event)
	})
}

func (s *Access) RevokeSession(ctx context.Context, id, owner uuid.UUID, event audit.Event) error {
	return s.transact(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if err := s.sessions.RevokeOwnedTx(ctx, tx, id, owner, auth.ReasonLogout); err != nil {
			return err
		}
		event.ObjectType, event.ObjectRef = "session", "session:"+id.String()
		return s.audit.RecordTx(ctx, tx, event)
	})
}
