package employees

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
)

var (
	ErrManagerBootstrapComplete = errors.New("an active manager administrator already exists")
	ErrManagerBootstrapEmployee = errors.New("bootstrap requires an active employee with a password")
)

func (s *Access) BootstrapManager(ctx context.Context, email string, event audit.Event) error {
	return s.transact(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `LOCK TABLE manager_grants IN SHARE ROW EXCLUSIVE MODE`); err != nil {
			return fmt.Errorf("lock manager bootstrap: %w", err)
		}
		var employeeID uuid.UUID
		err := tx.QueryRow(ctx, `
			SELECT id FROM employees
			WHERE email = $1 AND status = 'active' AND NULLIF(password_hash, '') IS NOT NULL
			FOR UPDATE`, auth.NormalizeEmail(email)).Scan(&employeeID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrManagerBootstrapEmployee
		}
		if err != nil {
			return fmt.Errorf("lookup manager bootstrap employee: %w", err)
		}
		var alreadyGranted, otherAdmin bool
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(bool_or(g.employee_id = $1), false),
			       COALESCE(bool_or(g.employee_id <> $1), false)
			FROM manager_grants g JOIN employees e ON e.id = g.employee_id
			WHERE g.grant_code = $2 AND e.status = 'active' AND NULLIF(e.password_hash, '') IS NOT NULL`,
			employeeID, auth.GrantStaffManage,
		).Scan(&alreadyGranted, &otherAdmin); err != nil {
			return fmt.Errorf("check first manager administrator: %w", err)
		}
		if alreadyGranted {
			return nil
		}
		if otherAdmin {
			return ErrManagerBootstrapComplete
		}
		grants := auth.ManagerAdminGrants()
		if _, err := tx.Exec(ctx, `
			INSERT INTO manager_grants (employee_id, grant_code)
			SELECT $1, unnest($2::text[])
			ON CONFLICT (employee_id, grant_code) DO NOTHING`, employeeID, grants); err != nil {
			return fmt.Errorf("grant first manager administrator access: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			UPDATE employees SET manager_grants_version = manager_grants_version + 1
			WHERE id = $1`, employeeID); err != nil {
			return fmt.Errorf("advance manager grants version: %w", err)
		}
		event.Action = audit.ActionManagerBootstrap
		event.ObjectType = "employee"
		event.ObjectRef = "employee:" + employeeID.String()
		event.Metadata = map[string]any{"audience": auth.Managers, "grants": grants, "source": "cli"}
		return s.audit.RecordTx(ctx, tx, event)
	})
}
