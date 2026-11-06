package fixture

import (
	"context"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

// crmUsersFreshFor mirrors the owner's in-memory snapshot lifetime.
const crmUsersFreshFor = 5 * time.Minute

func (a *Adapter) CRMUsersTimeout() time.Duration { return a.desc.Timeout }

// GetCRMUsers returns the labelled snapshot of a known account. A known
// account without a snapshot has no connection to read through, as in Core.
func (a *Adapter) GetCRMUsers(ctx context.Context, _ adapter.Actor, accountID int64) (adapter.Observation[adapter.CRMUsers], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.CRMUsers); err != nil {
		return adapter.Observation[adapter.CRMUsers]{}, err
	}
	known := false
	for _, account := range data.Accounts {
		if account.AccountID == accountID {
			known = true
			break
		}
	}
	if !known {
		return adapter.Observation[adapter.CRMUsers]{}, adapter.NotFound(a.desc.Code, "account not found")
	}
	now := time.Now().UTC()
	users, ok := data.CRMUsers[accountID]
	if !ok {
		users = adapter.CRMUsers{State: adapter.MapCRMUsersState(adapter.CRMUsersNoAuthorizedConnection)}
	}
	if users.State.Canonical == adapter.CRMUsersOK {
		freshUntil := now.Add(crmUsersFreshFor)
		total := len(users.Users)
		users.FreshUntil, users.Total = &freshUntil, &total
	}
	return adapter.Fresh(a.desc.Code, now, users), nil
}

func cloneCRMUsers(source adapter.CRMUsers) adapter.CRMUsers {
	out := source
	if source.Connection != nil {
		connection := *source.Connection
		out.Connection = &connection
	}
	if source.FreshUntil != nil {
		freshUntil := *source.FreshUntil
		out.FreshUntil = &freshUntil
	}
	if source.RetryAfter != nil {
		retryAfter := *source.RetryAfter
		out.RetryAfter = &retryAfter
	}
	if source.Total != nil {
		total := *source.Total
		out.Total = &total
	}
	if source.Users != nil {
		out.Users = append([]adapter.CRMUser{}, source.Users...)
	}
	return out
}

// demoCRMUsers keeps the owner's rule: users are read only through an active
// installation, so accounts without one stay no_authorized_connection.
func demoCRMUsers(c1, c4 adapter.ConnectionSummary) map[int64]adapter.CRMUsers {
	connection := func(c adapter.ConnectionSummary) *adapter.CRMUsersConnection {
		return &adapter.CRMUsersConnection{ID: c.ID, IntegrationID: c.IntegrationID, IntegrationCode: c.IntegrationCode}
	}
	retryAfter := 30 * time.Second
	return map[int64]adapter.CRMUsers{
		91000001: {
			State:      adapter.MapCRMUsersState(adapter.CRMUsersOK),
			Connection: connection(c1),
			Users: []adapter.CRMUser{
				{ID: 501, Name: "Fixture User A", IsActive: true, IsAdmin: true},
				{ID: 502, Name: "Fixture User B", IsActive: true},
				{ID: 507, Name: "Fixture User G"},
			},
		},
		91000002: {
			State:      adapter.MapCRMUsersState(adapter.CRMUsersRateLimited),
			Connection: connection(c4),
			RetryAfter: &retryAfter,
		},
	}
}
