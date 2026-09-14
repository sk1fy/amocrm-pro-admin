package accounts

import (
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

type Aggregated struct {
	AccountID      int64
	Domains        []string
	State          string
	Problems       []string
	Origin         string
	LastActivityAt time.Time
	Connections    []Connection
}

type Connection struct {
	AuthorizationDetails *adapter.Authorization
	WebhookDetails       *adapter.Webhook
	Backend              string
	ConnectionID         string
	IntegrationID        string
	IntegrationCode      string
	State                adapter.State
	Webhook              adapter.State
	Authorization        adapter.State
	Origin               string
	AccountDomain        string
	InstalledBy          *int64
	CreatedAt            time.Time
	UpdatedAt            time.Time
	Grants               []adapter.Grant
	Pilot                adapter.State
	RecentFailedJobs     int
	ObservedAt           time.Time
	Freshness            string
}

func Aggregate(account adapter.Account, backend string, sourceUnavailable bool) Aggregated {
	connections := make([]Connection, 0, len(account.Connections))
	for _, conn := range account.Connections {
		connections = append(connections, ConnectionFromSummary(backend, conn))
	}
	return AggregateConnections(account.AccountID, account.Domains, account.LastActivityAt, connections, sourceUnavailable)
}

func ConnectionFromSummary(backend string, conn adapter.ConnectionSummary) Connection {
	origin := conn.Origin
	if origin == "" {
		origin = adapter.OriginReal
	}
	// ConnectionSummary has no Freshness/ObservedAt. GetAccount copies them
	// from the account Observation; list items stay empty until then.
	return Connection{
		AuthorizationDetails: conn.AuthorizationDetails,
		WebhookDetails:       conn.WebhookDetails,
		Backend:              backend,
		ConnectionID:         conn.ID,
		IntegrationID:        conn.IntegrationID,
		IntegrationCode:      conn.IntegrationCode,
		State:                conn.Status,
		Webhook:              conn.WebhookStatus,
		Authorization:        conn.Authorization,
		Origin:               origin,
		AccountDomain:        conn.AccountDomain,
		InstalledBy:          conn.InstalledBy,
		CreatedAt:            conn.CreatedAt,
		UpdatedAt:            conn.UpdatedAt,
		Grants:               conn.Grants,
		Pilot:                conn.Pilot,
		RecentFailedJobs:     conn.RecentFailedJobs,
	}
}

func AggregateConnections(accountID int64, domains []string, lastActivity time.Time, connections []Connection, sourceUnavailable bool) Aggregated {
	if domains == nil {
		domains = []string{}
	}
	out := Aggregated{
		AccountID:      accountID,
		Domains:        uniqueStrings(domains),
		LastActivityAt: lastActivity,
		Connections:    connections,
		Origin:         originOf(connections),
	}
	if sourceUnavailable {
		out.State = adapter.AccountPartial
		out.Problems = problemsOf(connections, true)
		return out
	}
	out.Problems = problemsOf(connections, false)
	out.State = stateOf(connections)
	return out
}

func stateOf(connections []Connection) string {
	if len(connections) == 0 {
		return adapter.AccountInactive
	}
	if anyConnection(connections, connectionSourceUnavailable) {
		return adapter.AccountPartial
	}
	if anyConnection(connections, func(c Connection) bool {
		return c.State.Canonical == adapter.StatusReauthRequired ||
			(c.Authorization.Canonical == adapter.AuthMissing &&
				(c.State.Canonical == adapter.StatusActive || c.State.Canonical == adapter.StatusPending))
	}) {
		return adapter.AccountNeedsAction
	}
	if anyConnection(connections, func(c Connection) bool {
		return c.State.Canonical == adapter.StatusError || c.Webhook.Canonical == adapter.StatusError
	}) {
		return adapter.AccountError
	}
	if anyConnection(connections, func(c Connection) bool {
		if c.State.Canonical == adapter.StatusPending || c.State.Canonical == adapter.StatusAuthorizing {
			return true
		}
		if c.RecentFailedJobs > 0 {
			return true
		}
		if c.Freshness == adapter.FreshnessStale {
			return true
		}
		return authUnverifiedOnLive(c)
	}) {
		return adapter.AccountAttention
	}
	if allConnections(connections, func(c Connection) bool {
		return c.State.Canonical == adapter.StatusDisabled || c.State.Canonical == adapter.StatusUninstalled
	}) {
		return adapter.AccountInactive
	}
	if allConnections(connections, connectionLooksOK) {
		return adapter.AccountOK
	}
	return adapter.AccountAttention
}

func connectionSourceUnavailable(c Connection) bool {
	return c.Freshness == adapter.FreshnessUnavailable
}

func authUnverifiedOnLive(c Connection) bool {
	if c.State.Canonical != adapter.StatusActive && c.State.Canonical != adapter.StatusPending {
		return false
	}
	if c.AuthorizationDetails != nil {
		return c.AuthorizationDetails.Unverified
	}
	return false
}

func connectionLooksOK(c Connection) bool {
	if c.State.Canonical != adapter.StatusActive {
		return false
	}
	if c.Webhook.Canonical == adapter.StatusError {
		return false
	}
	if c.Authorization.Canonical == adapter.AuthMissing || c.Authorization.Canonical == adapter.AuthReauthRequired {
		return false
	}
	if c.Freshness == adapter.FreshnessStale || c.Freshness == adapter.FreshnessUnavailable {
		return false
	}
	return !authUnverifiedOnLive(c)
}

func problemsOf(connections []Connection, sourceUnavailable bool) []string {
	seen := map[string]bool{}
	var problems []string
	add := func(code string) {
		if seen[code] {
			return
		}
		seen[code] = true
		problems = append(problems, code)
	}
	if sourceUnavailable {
		add(adapter.ProblemSourceUnavailable)
	}
	for _, conn := range connections {
		if connectionSourceUnavailable(conn) {
			add(adapter.ProblemSourceUnavailable)
		}
		if conn.State.Canonical == adapter.StatusReauthRequired {
			add(adapter.ProblemReauthRequired)
		}
		if conn.Webhook.Canonical == adapter.StatusError {
			add(adapter.ProblemWebhookError)
		}
		if conn.Authorization.Canonical == adapter.AuthMissing &&
			(conn.State.Canonical == adapter.StatusActive || conn.State.Canonical == adapter.StatusPending) {
			add(adapter.ProblemMissingCredentials)
		}
		if conn.State.Canonical == adapter.StatusDisabled {
			add(adapter.ProblemDisabled)
		}
		if conn.RecentFailedJobs > 0 {
			add(adapter.ProblemJobFailures)
		}
	}
	if problems == nil {
		problems = []string{}
	}
	return problems
}

func originOf(connections []Connection) string {
	for _, conn := range connections {
		if conn.Origin == adapter.OriginFixture {
			return adapter.OriginFixture
		}
	}
	return adapter.OriginReal
}

func anyConnection(connections []Connection, pred func(Connection) bool) bool {
	for _, conn := range connections {
		if pred(conn) {
			return true
		}
	}
	return false
}

func allConnections(connections []Connection, pred func(Connection) bool) bool {
	if len(connections) == 0 {
		return false
	}
	for _, conn := range connections {
		if !pred(conn) {
			return false
		}
	}
	return true
}

func uniqueStrings(items []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		out = append(out, item)
	}
	return out
}
