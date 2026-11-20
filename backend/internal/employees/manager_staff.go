package employees

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
)

var (
	ErrStaffInvalid     = errors.New("invalid staff request")
	ErrStaffForbidden   = errors.New("manager permission denied")
	ErrLastManagerAdmin = errors.New("last manager administrator")
	ErrStaffVersion     = errors.New("staff version conflict")
	ErrStaffIdempotency = errors.New("staff command conflict")
	ErrSelfEscalation   = errors.New("self grant escalation")
	ErrInvitation       = errors.New("invitation unavailable")
)

type Staff struct {
	ID        uuid.UUID           `json:"id"`
	Email     string              `json:"email"`
	Name      string              `json:"name"`
	Status    string              `json:"status"`
	Grants    []auth.ManagerGrant `json:"grants"`
	Version   int64               `json:"version"`
	ChangedAt time.Time           `json:"changed_at"`
	ChangedBy *uuid.UUID          `json:"changed_by"`
	suspended bool
}

type StaffCommand struct {
	SessionID     uuid.UUID
	CommandID     uuid.UUID
	TargetID      uuid.UUID
	Kind          string
	Version       int64
	Email         string
	Name          string
	Grants        []auth.ManagerGrant
	AccessEnabled *bool
	Event         audit.Event
}

type StaffResult struct {
	Staff           Staff  `json:"staff"`
	LinkUnavailable bool   `json:"link_unavailable"`
	InvitationURL   string `json:"invitation_url,omitempty"`
}

const staffSelect = `SELECT e.id, e.email, e.name,
 CASE WHEN e.status <> 'active' THEN 'disabled'
 WHEN NOT EXISTS(SELECT 1 FROM manager_grants WHERE employee_id=e.id) THEN 'revoked'
 WHEN NULLIF(e.password_hash,'') IS NULL THEN 'invited' ELSE 'active' END,
 COALESCE(e.manager_suspended_grants,ARRAY(SELECT grant_code FROM manager_grants WHERE employee_id=e.id ORDER BY grant_code)),
 e.manager_grants_version, e.manager_changed_at, e.manager_changed_by,
 e.manager_suspended_grants IS NOT NULL FROM employees e`

func scanStaff(row pgx.Row) (Staff, error) {
	var v Staff
	err := row.Scan(&v.ID, &v.Email, &v.Name, &v.Status, &v.Grants, &v.Version, &v.ChangedAt, &v.ChangedBy, &v.suspended)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, ErrNotFound
	}
	return v, err
}

func lockManagerAccess(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, `LOCK TABLE manager_grants IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return fmt.Errorf("lock manager access: %w", err)
	}
	return nil
}
func eligibleManagerAdmin(ctx context.Context, tx pgx.Tx, id uuid.UUID) (bool, error) {
	var yes bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM employees e JOIN manager_grants g ON g.employee_id=e.id WHERE e.id=$1 AND e.status='active' AND NULLIF(e.password_hash,'') IS NOT NULL AND g.grant_code='staff.manage')`, id).Scan(&yes)
	return yes, err
}
func requireManagerAdmin(ctx context.Context, tx pgx.Tx) error {
	var yes bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM employees e JOIN manager_grants g ON g.employee_id=e.id WHERE e.status='active' AND NULLIF(e.password_hash,'') IS NOT NULL AND g.grant_code='staff.manage')`).Scan(&yes)
	if err != nil {
		return fmt.Errorf("check manager administrator: %w", err)
	}
	if !yes {
		return ErrLastManagerAdmin
	}
	return nil
}
func validStaffGrants(grants []auth.ManagerGrant) bool {
	if grants == nil {
		return false
	}
	seen := map[auth.ManagerGrant]bool{}
	for _, g := range grants {
		if seen[g] || !slices.Contains(auth.ManagerAdminGrants(), g) {
			return false
		}
		seen[g] = true
	}
	return true
}

func replaceManagerGrants(ctx context.Context, tx pgx.Tx, employee uuid.UUID, grants []auth.ManagerGrant) error {
	if _, err := tx.Exec(ctx, `DELETE FROM manager_grants WHERE employee_id=$1`, employee); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO manager_grants(employee_id,grant_code)
		SELECT $1,unnest($2::text[])`, employee, grants)
	return err
}
func (s *Access) staffActor(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, sessionID uuid.UUID, grant auth.ManagerGrant) (auth.Principal, []byte, error) {
	p, key, err := s.sessions.ManagerSnapshotTx(ctx, db, sessionID)
	if err != nil {
		return p, nil, err
	}
	if !slices.Contains(p.Account.ManagerGrants, grant) {
		return p, nil, ErrStaffForbidden
	}
	return p, key, nil
}

func (s *Access) ManagerStaffCommand(ctx context.Context, c StaffCommand) (StaffResult, string, error) {
	var result StaffResult
	var plain string
	if c.CommandID == uuid.Nil || (c.Kind != "invite" && c.TargetID == uuid.Nil) {
		return result, "", ErrStaffInvalid
	}
	if c.Kind == "access" && c.AccessEnabled == nil {
		return result, "", ErrStaffInvalid
	}
	if c.Kind == "invite" || c.Kind == "grants" {
		if !validStaffGrants(c.Grants) {
			return result, "", ErrStaffInvalid
		}
		c.Grants = slices.Clone(c.Grants)
		slices.Sort(c.Grants)
	}
	if c.Kind == "invite" {
		c.Email = auth.NormalizeEmail(c.Email)
		c.Name = strings.TrimSpace(c.Name)
		a, err := mail.ParseAddress(c.Email)
		if err != nil || a.Address != c.Email || len(c.Email) > auth.MaxEmailLength || utf8.RuneCountInString(c.Name) < 1 || utf8.RuneCountInString(c.Name) > 200 || len(c.Grants) == 0 {
			return result, "", ErrStaffInvalid
		}
	}
	if (c.Kind == "grants" || c.Kind == "access" || c.Kind == "reissue") && c.Version < 1 {
		return result, "", ErrStaffInvalid
	}
	normalized, _ := json.Marshal(struct {
		Kind          string
		Target        uuid.UUID
		Version       int64
		Email, Name   string
		Grants        []auth.ManagerGrant
		AccessEnabled *bool `json:",omitempty"`
	}{c.Kind, c.TargetID, c.Version, c.Email, c.Name, c.Grants, c.AccessEnabled})
	fingerprint := sha256.Sum256(normalized)
	err := s.transact(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if err := lockManagerAccess(ctx, tx); err != nil {
			return err
		}
		actor, _, err := s.staffActor(ctx, tx, c.SessionID, auth.GrantStaffManage)
		if err != nil {
			return err
		}
		if c.Kind != "grants" && c.Kind != "access" && !slices.Contains(actor.Account.ManagerGrants, auth.GrantIdentityManage) {
			return ErrStaffForbidden
		}
		var previousHash, raw []byte
		err = tx.QueryRow(ctx, `SELECT request_hash,result FROM manager_staff_receipts WHERE actor_id=$1 AND command_id=$2`, actor.EmployeeID, c.CommandID).Scan(&previousHash, &raw)
		if err == nil {
			if !bytes.Equal(previousHash, fingerprint[:]) {
				return ErrStaffIdempotency
			}
			if err := json.Unmarshal(raw, &result); err != nil {
				return fmt.Errorf("read staff receipt: %w", err)
			}
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("lookup staff receipt: %w", err)
		}
		target := c.TargetID
		var current Staff
		if c.Kind == "invite" {
			err = tx.QueryRow(ctx, `INSERT INTO employees(email,name,role,status,technical_access,manager_changed_by) VALUES($1,$2,'viewer','active',false,$3) RETURNING id`, c.Email, c.Name, actor.EmployeeID).Scan(&target)
			if isUniqueViolation(err) {
				return ErrConflict
			}
			if err != nil {
				return fmt.Errorf("create invited employee: %w", err)
			}
		} else {
			if _, err := s.store.lockRecord(ctx, tx, target); err != nil {
				return err
			}
			current, err = scanStaff(tx.QueryRow(ctx, staffSelect+` WHERE e.id=$1`, target))
			if err != nil {
				return err
			}
			if (c.Kind == "grants" || c.Kind == "access" || c.Kind == "reissue") && current.Version != c.Version {
				return ErrStaffVersion
			}
			if c.Kind == "access" && target == actor.EmployeeID {
				return ErrStaffForbidden
			}
			if c.Kind == "access" && (len(current.Grants) == 0 || (current.Status != "active" && current.Status != "revoked")) {
				return ErrStaffInvalid
			}
			if c.Kind == "grants" && target == actor.EmployeeID {
				for _, g := range c.Grants {
					if !slices.Contains(current.Grants, g) {
						return ErrSelfEscalation
					}
				}
			}
			if c.Kind == "reissue" {
				var pending bool
				if err := tx.QueryRow(ctx, `SELECT NOT technical_access AND password_hash IS NULL AND status='active' AND EXISTS(SELECT 1 FROM manager_invitations WHERE employee_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL) FROM employees WHERE id=$1`, target).Scan(&pending); err != nil {
					return err
				}
				if !pending {
					return ErrInvitation
				}
			}
		}
		switch c.Kind {
		case "invite", "grants":
			if current.suspended {
				_, err = tx.Exec(ctx, `UPDATE employees SET manager_suspended_grants=
					NULLIF($2::text[],ARRAY[]::text[]) WHERE id=$1`, target, c.Grants)
			} else {
				err = replaceManagerGrants(ctx, tx, target, c.Grants)
			}
			if err != nil {
				return err
			}
			if c.Kind == "grants" {
				if err := s.sessions.ManagerRevokeAudienceTx(ctx, tx, target); err != nil {
					return err
				}
			}
		case "access":
			grants, suspended := current.Grants, []auth.ManagerGrant(nil)
			if !*c.AccessEnabled {
				grants, suspended = suspended, grants
			}
			if _, err := tx.Exec(ctx, `UPDATE employees SET manager_suspended_grants=$2
				WHERE id=$1`, target, suspended); err != nil {
				return err
			}
			if err := replaceManagerGrants(ctx, tx, target, grants); err != nil {
				return err
			}
			if current.suspended || !*c.AccessEnabled {
				if err := s.sessions.ManagerRevokeAudienceTx(ctx, tx, target); err != nil {
					return err
				}
			}
		case "reissue", "revoke_sessions":
			if c.Kind == "revoke_sessions" {
				if err := s.sessions.ManagerRevokeAudienceTx(ctx, tx, target); err != nil {
					return err
				}
			}
		default:
			return ErrStaffInvalid
		}
		if c.Kind == "invite" || c.Kind == "reissue" {
			if _, err := tx.Exec(ctx, `UPDATE manager_invitations SET revoked_at=now() WHERE employee_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL`, target); err != nil {
				return err
			}
			var hash []byte
			plain, hash, err = auth.NewToken()
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO manager_invitations(employee_id,token_hash,expires_at,created_by) VALUES($1,$2,now()+interval '48 hours',$3)`, target, hash, actor.EmployeeID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE employees SET manager_grants_version=manager_grants_version+1,manager_changed_at=now(),manager_changed_by=$2 WHERE id=$1`, target, actor.EmployeeID); err != nil {
			return err
		}
		if err := requireManagerAdmin(ctx, tx); err != nil {
			return err
		}
		result.Staff, err = scanStaff(tx.QueryRow(ctx, staffSelect+` WHERE e.id=$1`, target))
		if err != nil {
			return err
		}
		result.LinkUnavailable = c.Kind == "invite" || c.Kind == "reissue"
		event := c.Event
		event.EmployeeID = &actor.EmployeeID
		event.ActorEmail = actor.Account.Email
		event.Action = "manager.staff." + c.Kind
		event.ObjectType = "employee"
		event.ObjectRef = "employee:" + target.String()
		event.Metadata = map[string]any{"audience": auth.Managers, "grants": result.Staff.Grants, "version": result.Staff.Version}
		if c.AccessEnabled != nil {
			event.Metadata["access_enabled"] = *c.AccessEnabled
		}
		if err := s.audit.RecordTx(ctx, tx, event); err != nil {
			return err
		}
		safe, err := json.Marshal(result)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO manager_staff_receipts(actor_id,command_id,request_hash,result) VALUES($1,$2,$3,$4)`, actor.EmployeeID, c.CommandID, fingerprint[:], safe)
		return err
	})
	if err != nil {
		return StaffResult{}, "", err
	}
	if plain != "" {
		result.LinkUnavailable = false
	}
	return result, plain, nil
}

func (s *Access) AcceptManagerInvitation(ctx context.Context, token, password string, commandID uuid.UUID, event audit.Event) error {
	if commandID == uuid.Nil {
		return ErrStaffInvalid
	}
	hash, err := auth.HashToken(token)
	if err != nil {
		return ErrInvitation
	}
	if utf8.RuneCountInString(password) < 8 || len(password) > 1024 {
		return ErrStaffInvalid
	}
	encoded, err := auth.Hash(password)
	if err != nil {
		return err
	}
	return s.transact(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if err := lockManagerAccess(ctx, tx); err != nil {
			return err
		}
		var target uuid.UUID
		err := tx.QueryRow(ctx, `SELECT employee_id FROM manager_invitations WHERE token_hash=$1`, hash).Scan(&target)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvitation
		}
		if err != nil {
			return err
		}
		if _, err := s.store.lockRecord(ctx, tx, target); err != nil {
			return err
		}
		var accepted *uuid.UUID
		var consumed *time.Time
		var currentHash *string
		if err := tx.QueryRow(ctx, `SELECT i.accepted_command,i.consumed_at,e.password_hash FROM manager_invitations i JOIN employees e ON e.id=i.employee_id WHERE i.token_hash=$1 FOR UPDATE OF i`, hash).Scan(&accepted, &consumed, &currentHash); err != nil {
			return err
		}
		if consumed != nil {
			if accepted != nil && *accepted == commandID && currentHash != nil && auth.Verify(password, *currentHash) {
				return nil
			}
			return ErrInvitation
		}
		var invitationID uuid.UUID
		err = tx.QueryRow(ctx, `SELECT i.id FROM manager_invitations i JOIN employees e ON e.id=i.employee_id
    WHERE i.token_hash=$1 AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>clock_timestamp()
    AND NOT e.technical_access AND e.password_hash IS NULL AND e.status='active'
    AND EXISTS(SELECT 1 FROM manager_grants WHERE employee_id=e.id) FOR UPDATE OF i`, hash).Scan(&invitationID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvitation
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE employees SET password_hash=$2,manager_grants_version=manager_grants_version+1,manager_changed_at=now(),manager_changed_by=$1 WHERE id=$1`, target, encoded); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE manager_invitations SET consumed_at=now(),accepted_command=$2 WHERE id=$1`, invitationID, commandID); err != nil {
			return err
		}
		event.EmployeeID = &target
		event.Action = "manager.invitation.accept"
		event.ObjectType = "employee"
		event.ObjectRef = "employee:" + target.String()
		event.Metadata = map[string]any{"audience": auth.Managers}
		return s.audit.RecordTx(ctx, tx, event)
	})
}
