package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Audience string

const (
	CoreAdmin Audience = "core-admin"
	Managers  Audience = "managers"

	ManagerCookieName = "manager_session"
)

type ManagerGrant string

const (
	GrantCatalogManage       ManagerGrant = "catalog.manage"
	GrantClientsRead         ManagerGrant = "clients.read"
	GrantClientsRenew        ManagerGrant = "clients.renew"
	GrantClientsWrite        ManagerGrant = "clients.write"
	GrantConfigurationManage ManagerGrant = "configuration.manage"
	GrantFeedRead            ManagerGrant = "feed.read"
	GrantIdentityManage      ManagerGrant = "identity.manage"
	GrantSecurityAuditRead   ManagerGrant = "security.audit.read"
	GrantStaffManage         ManagerGrant = "staff.manage"
	GrantStatsRead           ManagerGrant = "stats.read"
)

func ManagerAdminGrants() []ManagerGrant {
	return []ManagerGrant{
		GrantCatalogManage, GrantClientsRead, GrantClientsRenew, GrantClientsWrite,
		GrantConfigurationManage, GrantFeedRead, GrantIdentityManage,
		GrantSecurityAuditRead, GrantStaffManage, GrantStatsRead,
	}
}

func NewManagerService(pool *pgxpool.Pool, timeout, absoluteTTL, idleTTL time.Duration, cookieSecure bool) *Service {
	service := NewService(pool, timeout, absoluteTTL, idleTTL, cookieSecure)
	service.audience = Managers
	return service
}

func (s *Service) Audience() Audience {
	return s.audience
}

func (s *Service) cookieName() string {
	if s.audience == Managers {
		return ManagerCookieName
	}
	return CookieName
}

func (s *Service) managerGrants(ctx context.Context, employeeID uuid.UUID) ([]ManagerGrant, int64, error) {
	var grants []ManagerGrant
	var version int64
	err := s.pool.QueryRow(ctx, `
		SELECT ARRAY(
			SELECT grant_code FROM manager_grants
			WHERE employee_id = e.id ORDER BY grant_code
		), e.manager_grants_version FROM employees e WHERE e.id = $1`, employeeID).Scan(&grants, &version)
	if err != nil {
		return nil, 0, fmt.Errorf("lookup manager grants: %w", err)
	}
	return grants, version, nil
}

func (s *Service) ManagerSnapshot(ctx context.Context, sessionID uuid.UUID) (Principal, error) {
	if s.audience != Managers || sessionID == uuid.Nil {
		return Principal{}, ErrUnauthenticated
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	return s.lookupManager(ctx, nil, &sessionID, false)
}

func (s *Service) lookupManager(ctx context.Context, hash []byte, sessionID *uuid.UUID, touch bool) (Principal, error) {
	principal := Principal{Audience: Managers}
	var lastSeen time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT s.id, s.employee_id, s.last_seen_at, e.email, e.name, e.role, e.status,
		       ARRAY(SELECT grant_code FROM manager_grants
		             WHERE employee_id = e.id ORDER BY grant_code),
		       e.manager_grants_version
		FROM sessions s
		JOIN employees e ON e.id = s.employee_id
		WHERE (($1::bytea IS NOT NULL AND s.token_hash = $1)
		       OR ($2::uuid IS NOT NULL AND s.id = $2))
		  AND s.audience = 'managers' AND e.status = 'active' AND NULLIF(e.password_hash,'') IS NOT NULL
		  AND s.revoked_at IS NULL AND s.expires_at > now()
		  AND s.last_seen_at > now() - ($3 * interval '1 millisecond')`,
		hash, sessionID, s.idleTTL.Milliseconds(),
	).Scan(&principal.SessionID, &principal.EmployeeID, &lastSeen, &principal.Account.Email,
		&principal.Account.Name, &principal.Account.Role, &principal.Account.Status,
		&principal.Account.ManagerGrants, &principal.Account.ManagerGrantsVersion)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && len(principal.Account.ManagerGrants) == 0) {
		return Principal{}, ErrUnauthenticated
	}
	if err != nil {
		return Principal{}, fmt.Errorf("lookup manager session: %w", err)
	}
	principal.Account.ID = principal.EmployeeID
	if touch && time.Since(lastSeen) >= time.Minute {
		_, _ = s.pool.Exec(ctx, `
			UPDATE sessions SET last_seen_at = now()
			WHERE id = $1 AND revoked_at IS NULL AND last_seen_at <= now() - interval '1 minute'`, principal.SessionID)
	}
	return principal, nil
}

// ManagerSnapshotTx rechecks the live session using the caller's transaction.
func (s *Service) ManagerSnapshotTx(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, sessionID uuid.UUID) (Principal, []byte, error) {
	var p Principal
	var key []byte
	err := db.QueryRow(ctx, `SELECT s.id, e.id, e.email, e.name, e.manager_grants_version,
        ARRAY(SELECT grant_code FROM manager_grants WHERE employee_id = e.id ORDER BY grant_code), s.token_hash
        FROM sessions s JOIN employees e ON e.id = s.employee_id
        WHERE s.id = $1 AND s.audience = 'managers' AND s.revoked_at IS NULL
        AND s.expires_at > clock_timestamp() AND s.last_seen_at > clock_timestamp() - ($2 * interval '1 millisecond')
        AND e.status = 'active' AND NULLIF(e.password_hash, '') IS NOT NULL`, sessionID, s.idleTTL.Milliseconds()).Scan(
		&p.SessionID, &p.EmployeeID, &p.Account.Email, &p.Account.Name, &p.Account.ManagerGrantsVersion, &p.Account.ManagerGrants, &key)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && len(p.Account.ManagerGrants) == 0) {
		return Principal{}, nil, ErrUnauthenticated
	}
	if err != nil {
		return Principal{}, nil, fmt.Errorf("check manager actor: %w", err)
	}
	p.Audience, p.Account.ID = Managers, p.EmployeeID
	return p, key, nil
}
