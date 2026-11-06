package adapter

import (
	"context"
	"time"
)

// Canonical states of a CRM users read. Only CRMUsersOK carries a list; every
// other state means the list is unknown, not empty.
const (
	CRMUsersOK                     = "ok"
	CRMUsersNoAuthorizedConnection = "no_authorized_connection"
	CRMUsersAuthError              = "auth_error"
	CRMUsersRateLimited            = "rate_limited"
	CRMUsersIncomplete             = "incomplete"
	CRMUsersNetworkError           = "network_error"
	CRMUsersInternalError          = "internal_error"

	// MaxCRMUsers bounds one snapshot: the owner reads at most four amoCRM
	// pages of 250 users and reports a larger account as incomplete.
	MaxCRMUsers = 1000
)

var crmUsersStates = newSet(
	CRMUsersOK, CRMUsersNoAuthorizedConnection, CRMUsersAuthError, CRMUsersRateLimited,
	CRMUsersIncomplete, CRMUsersNetworkError, CRMUsersInternalError,
)

func MapCRMUsersState(raw string) State { return mapKnown(raw, crmUsersStates) }

// CRMUsers is the outcome of reading amoCRM users of one account through the
// installation the backend chose. Users and Total are nil unless the state is
// ok. Contact fields, groups and rights are deliberately absent.
type CRMUsers struct {
	State      State
	Connection *CRMUsersConnection
	FreshUntil *time.Time
	RetryAfter *time.Duration
	Users      []CRMUser
	Total      *int
}

// CRMUsersConnection identifies the installation the users were read through.
type CRMUsersConnection struct {
	ID              string
	IntegrationID   string
	IntegrationCode string
}

type CRMUser struct {
	ID       int64
	Name     string
	IsActive bool
	IsAdmin  bool
}

// CRMUsersBackend is optional. The read reaches amoCRM through the backend that
// owns amoCRM traffic, so it has its own timeout instead of the descriptor's.
type CRMUsersBackend interface {
	CRMUsersTimeout() time.Duration
	GetCRMUsers(ctx context.Context, actor Actor, accountID int64) (Observation[CRMUsers], error)
}

// AsCRMUsers returns the CRM users interface only when the backend both
// declares the capability and implements the interface.
func AsCRMUsers(backend Backend) (CRMUsersBackend, bool) {
	if backend == nil || !backend.Capabilities().CRMUsers {
		return nil, false
	}
	users, ok := backend.(CRMUsersBackend)
	if !ok {
		return nil, false
	}
	return users, true
}
