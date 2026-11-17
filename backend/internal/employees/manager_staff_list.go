package employees

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
)

type StaffPage struct {
	Items      []Staff `json:"items"`
	NextCursor *string `json:"next_cursor"`
}
type ManagerAuditEntry struct {
	ID        int64      `json:"id"`
	ActorID   *uuid.UUID `json:"actor_id"`
	Action    string     `json:"action"`
	ObjectRef string     `json:"object_ref"`
	Outcome   string     `json:"outcome"`
	CreatedAt time.Time  `json:"created_at"`
}
type ManagerAuditPage struct {
	Items      []ManagerAuditEntry `json:"items"`
	NextCursor *string             `json:"next_cursor"`
}
type staffCursor struct {
	Scope   string    `json:"scope"`
	Actor   uuid.UUID `json:"actor"`
	Session uuid.UUID `json:"session"`
	Version int64     `json:"version"`
	Search  string    `json:"search"`
	Limit   int       `json:"limit"`
	Expires int64     `json:"expires"`
	Email   string    `json:"email,omitempty"`
	ID      uuid.UUID `json:"id,omitempty"`
	At      time.Time `json:"at,omitempty"`
	AuditID int64     `json:"audit_id,omitempty"`
}

func cursorMAC(key, raw []byte) []byte {
	m := hmac.New(sha256.New, key)
	_, _ = m.Write([]byte("admin.manager.staff.cursor.v1\x00"))
	_, _ = m.Write(raw)
	return m.Sum(nil)
}
func sealCursor(key []byte, c staffCursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(cursorMAC(key, raw))
}
func openCursor(key []byte, raw string, expected staffCursor) (staffCursor, error) {
	fail := func() (staffCursor, error) { return staffCursor{}, ErrStaffInvalid }
	if len(raw) > 4096 {
		return fail()
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return fail()
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return fail()
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(sig, cursorMAC(key, data)) {
		return fail()
	}
	var c staffCursor
	if json.Unmarshal(data, &c) != nil || c.Scope != expected.Scope || c.Actor != expected.Actor || c.Session != expected.Session || c.Version != expected.Version || c.Search != expected.Search || c.Limit != expected.Limit || c.Expires < time.Now().Unix() {
		return fail()
	}
	return c, nil
}
func (s *Access) staffCursor(ctx context.Context, tx pgx.Tx, session uuid.UUID, grant auth.ManagerGrant, scope, search, raw string, limit int) (staffCursor, []byte, error) {
	if limit < 1 || limit > 100 || len(search) > 200 {
		return staffCursor{}, nil, ErrStaffInvalid
	}
	p, key, err := s.staffActor(ctx, tx, session, grant)
	if err != nil {
		return staffCursor{}, nil, err
	}
	c := staffCursor{Scope: scope, Actor: p.EmployeeID, Session: p.SessionID, Version: p.Account.ManagerGrantsVersion, Search: search, Limit: limit, Expires: time.Now().Add(30 * time.Minute).Unix()}
	if raw != "" {
		c, err = openCursor(key, raw, c)
	}
	return c, key, err
}
func (s *Access) ManagerStaffList(ctx context.Context, session uuid.UUID, search, cursor string, limit int) (StaffPage, error) {
	page := StaffPage{Items: []Staff{}}
	search = strings.TrimSpace(strings.ToLower(search))
	err := s.transact(ctx, func(ctx context.Context, tx pgx.Tx) error {
		c, key, err := s.staffCursor(ctx, tx, session, auth.GrantStaffManage, "staff.email.asc", search, cursor, limit)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, staffSelect+` WHERE (strpos(lower(e.email),$1)>0 OR strpos(lower(e.name),$1)>0)
    AND ($2='' OR (e.email,e.id)>($2,$3)) ORDER BY e.email,e.id LIMIT $4`, search, c.Email, c.ID, limit+1)
		if err != nil {
			return fmt.Errorf("list manager staff: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			v, err := scanStaff(rows)
			if err != nil {
				return err
			}
			page.Items = append(page.Items, v)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		if len(page.Items) > limit {
			last := page.Items[limit-1]
			c.Email, c.ID = last.Email, last.ID
			next := sealCursor(key, c)
			page.NextCursor = &next
			page.Items = page.Items[:limit]
		}
		return nil
	})
	return page, err
}
func (s *Access) ManagerStaffGet(ctx context.Context, session, id uuid.UUID) (Staff, error) {
	var staff Staff
	err := s.transact(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if _, _, err := s.staffActor(ctx, tx, session, auth.GrantStaffManage); err != nil {
			return err
		}
		var err error
		staff, err = scanStaff(tx.QueryRow(ctx, staffSelect+` WHERE e.id=$1`, id))
		return err
	})
	return staff, err
}
func (s *Access) ManagerGrantCatalog(ctx context.Context, session uuid.UUID) ([]auth.ManagerGrant, error) {
	ctx, cancel := context.WithTimeout(ctx, s.store.timeout)
	defer cancel()
	if _, _, err := s.staffActor(ctx, s.store.pool, session, auth.GrantStaffManage); err != nil {
		return nil, err
	}
	return auth.ManagerAdminGrants(), nil
}
func (s *Access) ManagerSecurityAudit(ctx context.Context, session uuid.UUID, cursor string, limit int) (ManagerAuditPage, error) {
	page := ManagerAuditPage{Items: []ManagerAuditEntry{}}
	err := s.transact(ctx, func(ctx context.Context, tx pgx.Tx) error {
		c, key, err := s.staffCursor(ctx, tx, session, auth.GrantSecurityAuditRead, "audit.created.desc", "", cursor, limit)
		if err != nil {
			return err
		}
		var at *time.Time
		if !c.At.IsZero() {
			at = &c.At
		}
		rows, err := tx.Query(ctx, `SELECT id,employee_id,action,COALESCE(object_ref,''),outcome,created_at FROM admin_audit_log
    WHERE (action=ANY($1::text[]) OR (action IN ('auth.login','auth.login_failed','auth.logout') AND metadata->>'audience'='managers')) AND ($2::timestamptz IS NULL OR (created_at,id)<($2,$3))
    ORDER BY created_at DESC,id DESC LIMIT $4`, []string{"manager.bootstrap", "manager.staff.invite", "manager.staff.grants", "manager.staff.reissue", "manager.staff.revoke_sessions", "manager.invitation.accept"}, at, c.AuditID, limit+1)
		if err != nil {
			return fmt.Errorf("list manager security audit: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var e ManagerAuditEntry
			if err := rows.Scan(&e.ID, &e.ActorID, &e.Action, &e.ObjectRef, &e.Outcome, &e.CreatedAt); err != nil {
				return err
			}
			page.Items = append(page.Items, e)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		if len(page.Items) > limit {
			last := page.Items[limit-1]
			c.At, c.AuditID = last.CreatedAt, last.ID
			next := sealCursor(key, c)
			page.NextCursor = &next
			page.Items = page.Items[:limit]
		}
		return nil
	})
	return page, err
}
