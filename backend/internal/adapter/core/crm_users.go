package core

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

// maxRetryAfter bounds a retry hint so a malformed value cannot overflow.
const maxRetryAfter = 24 * time.Hour

var errInvalidCRMUsers = errors.New("invalid crm users response")

type crmUsersResponse struct {
	Source            string              `json:"source"`
	ObservedAt        time.Time           `json:"observed_at"`
	AccountID         int64               `json:"account_id"`
	State             string              `json:"state"`
	RetryAfterSeconds *int64              `json:"retry_after_seconds"`
	Connection        *crmUsersConnection `json:"connection"`
	FreshUntil        *time.Time          `json:"fresh_until"`
	Items             []crmUserItem       `json:"items"`
	Total             *int                `json:"total"`
}

type crmUsersConnection struct {
	InstallationID  string `json:"installation_id"`
	IntegrationID   string `json:"integration_id"`
	IntegrationCode string `json:"integration_code"`
}

type crmUserItem struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	IsActive bool   `json:"is_active"`
	IsAdmin  bool   `json:"is_admin"`
}

func (c *Client) CRMUsersTimeout() time.Duration {
	if c.crm == nil {
		return c.desc.Timeout
	}
	return c.crm.timeout
}

// GetCRMUsers reads the users snapshot from the Core worker listener. A failed
// amoCRM read is a fact with its own state, not a backend error; only a broken
// Core answer makes the source unavailable.
func (c *Client) GetCRMUsers(ctx context.Context, actor adapter.Actor, accountID int64) (adapter.Observation[adapter.CRMUsers], error) {
	if c.crm == nil {
		return adapter.Observation[adapter.CRMUsers]{}, adapter.Unsupported(c.desc.Code, "crm users listener is not configured")
	}
	var resp crmUsersResponse
	path := "/admin/v1/accounts/" + strconv.FormatInt(accountID, 10) + "/crm-users"
	if err := c.getAt(ctx, actor, *c.crm, path, nil, &resp); err != nil {
		return adapter.Observation[adapter.CRMUsers]{}, err
	}
	users, err := mapCRMUsers(resp, accountID)
	if err != nil {
		return adapter.Observation[adapter.CRMUsers]{}, adapter.Unavailable(c.desc.Code, "core returned invalid crm users")
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, users), nil
}

func mapCRMUsers(resp crmUsersResponse, accountID int64) (adapter.CRMUsers, error) {
	if resp.AccountID != accountID || resp.ObservedAt.IsZero() {
		return adapter.CRMUsers{}, errInvalidCRMUsers
	}
	out := adapter.CRMUsers{State: adapter.MapCRMUsersState(resp.State)}
	if resp.Connection != nil {
		connection := adapter.CRMUsersConnection{
			ID:              strings.TrimSpace(resp.Connection.InstallationID),
			IntegrationID:   strings.TrimSpace(resp.Connection.IntegrationID),
			IntegrationCode: strings.TrimSpace(resp.Connection.IntegrationCode),
		}
		if connection.ID == "" || connection.IntegrationID == "" {
			return adapter.CRMUsers{}, errInvalidCRMUsers
		}
		out.Connection = &connection
	}
	if seconds := resp.RetryAfterSeconds; seconds != nil && *seconds > 0 && *seconds <= int64(maxRetryAfter/time.Second) {
		retryAfter := time.Duration(*seconds) * time.Second
		out.RetryAfter = &retryAfter
	}
	if out.State.Canonical != adapter.CRMUsersOK {
		// The list is unknown in every other state; never pass a partial one on.
		return out, nil
	}
	if out.Connection == nil || resp.Items == nil || resp.Total == nil ||
		*resp.Total != len(resp.Items) || len(resp.Items) > adapter.MaxCRMUsers {
		return adapter.CRMUsers{}, errInvalidCRMUsers
	}
	users := make([]adapter.CRMUser, 0, len(resp.Items))
	for _, item := range resp.Items {
		if item.ID <= 0 {
			return adapter.CRMUsers{}, errInvalidCRMUsers
		}
		users = append(users, adapter.CRMUser{ID: item.ID, Name: item.Name, IsActive: item.IsActive, IsAdmin: item.IsAdmin})
	}
	total := len(users)
	out.Users, out.Total = users, &total
	if resp.FreshUntil != nil {
		freshUntil := resp.FreshUntil.UTC()
		out.FreshUntil = &freshUntil
	}
	return out, nil
}
