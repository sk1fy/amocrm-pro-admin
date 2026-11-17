package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
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

func (s *Service) managerGrants(ctx context.Context, employeeID uuid.UUID) ([]ManagerGrant, error) {
	var grants []ManagerGrant
	err := s.pool.QueryRow(ctx, `
		SELECT ARRAY(
			SELECT grant_code FROM manager_grants
			WHERE employee_id = $1 ORDER BY grant_code
		)`, employeeID).Scan(&grants)
	if err != nil {
		return nil, fmt.Errorf("lookup manager grants: %w", err)
	}
	return grants, nil
}
