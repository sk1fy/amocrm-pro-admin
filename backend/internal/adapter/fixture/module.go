package fixture

import (
	"fmt"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

const (
	moduleIntegrationCode = "fixture-module-widget"
	moduleIntegrationID   = "0f2a0002-0000-4000-8000-000000000001"
)

// Module returns a second demo adapter used to prove the v1 contract: it shares
// accounts with Demo, declares fewer capabilities (no settings, no
// subscriptions, no commands, no jobs) and keeps its own labelled data.
func Module(code string) *Adapter {
	return ModuleWithTimeout(code, 0)
}

// ModuleWithTimeout is Module with an explicit descriptor timeout; zero keeps
// the adapter default. The catalog passes the backend timeout from
// backends.yaml.
func ModuleWithTimeout(code string, timeout time.Duration) *Adapter {
	caps := adapter.Capabilities{
		Accounts: true, Connections: true, Integrations: true, Audit: true,
	}
	return New(Options{Code: code, Timeout: timeout, Data: moduleData(), Caps: &caps})
}

func moduleData() Data {
	now := time.Date(2026, 9, 12, 11, 0, 0, 0, time.UTC)
	id := moduleConnectionID
	checked := now.Add(-4 * time.Minute)
	domainShared := "fixture-two.amocrm.test"

	conn := func(n int, accountID int64, domain, status, webhook, auth string, updated time.Time) adapter.ConnectionSummary {
		return adapter.ConnectionSummary{
			ID: id(n), IntegrationID: moduleIntegrationID, IntegrationCode: moduleIntegrationCode,
			AccountID: accountID, AccountDomain: domain,
			Status:        adapter.State{Canonical: status},
			WebhookStatus: adapter.State{Canonical: webhook},
			Authorization: adapter.State{Canonical: auth},
			Origin:        adapter.OriginFixture,
			CreatedAt:     updated.Add(-6 * time.Hour), UpdatedAt: updated,
			Grants: []adapter.Grant{{Service: "fixture-module", State: adapter.MapGrant(true)}},
		}
	}

	m1 := conn(1, 92000001, "fixture-module-one.amocrm.test", adapter.StatusActive, adapter.StatusActive, adapter.AuthValid, now.Add(-2*time.Minute))
	m2 := conn(2, 92000002, "fixture-module-two.amocrm.test", adapter.StatusPending, adapter.StatusPending, adapter.AuthMissing, now.Add(-25*time.Minute))
	m3 := conn(3, 91000002, domainShared, adapter.StatusActive, adapter.StatusActive, adapter.AuthValid, now.Add(-3*time.Minute))

	details := map[string]adapter.ConnectionDetail{}
	for _, summary := range []adapter.ConnectionSummary{m1, m2, m3} {
		webhookStatus := summary.WebhookStatus.Canonical
		details[summary.ID] = adapter.ConnectionDetail{
			Connection: summary,
			Authorization: adapter.Authorization{
				State: adapter.State{Canonical: summary.Authorization.Canonical},
			},
			Webhook: adapter.Webhook{
				Status: adapter.State{Canonical: webhookStatus}, Events: []string{"add_lead"},
				CheckedAt: &checked,
			},
			Grants: summary.Grants,
		}
	}

	auditByConn := map[string][]adapter.AuditEntry{}
	for i, summary := range []adapter.ConnectionSummary{m1, m2, m3} {
		connectionID := summary.ID
		actor := "fixture-module@example.invalid"
		auditByConn[summary.ID] = []adapter.AuditEntry{{
			ID: int64(i + 1), InstallationID: &connectionID, ActorType: "fixture", ActorID: &actor,
			Action: "installation.fixture_seeded", ObjectType: strPtr("installation"), ObjectID: &connectionID,
			Metadata: []byte(`{"origin":"fixture","backend":"module"}`), CreatedAt: now.Add(-time.Minute),
		}}
	}

	return Data{
		Accounts: []adapter.Account{
			{AccountID: 91000002, Domains: []string{domainShared}, Origin: adapter.OriginFixture, LastActivityAt: m3.UpdatedAt, Connections: []adapter.ConnectionSummary{m3}},
			{AccountID: 92000001, Domains: []string{"fixture-module-one.amocrm.test"}, Origin: adapter.OriginFixture, LastActivityAt: m1.UpdatedAt, Connections: []adapter.ConnectionSummary{m1}},
			{AccountID: 92000002, Domains: []string{"fixture-module-two.amocrm.test"}, Origin: adapter.OriginFixture, LastActivityAt: m2.UpdatedAt, Connections: []adapter.ConnectionSummary{m2}},
		},
		ConnectionDetails: details,
		Integrations: []adapter.Integration{{
			ID: moduleIntegrationID, Code: moduleIntegrationCode, ClientID: moduleIntegrationID,
			RedirectURI:   "https://backend.example.invalid/oauth/amocrm/callback",
			Status:        adapter.State{Canonical: adapter.StatusActive},
			WebhookEvents: []string{"add_lead"},
			CreatedAt:     now.Add(-10 * 24 * time.Hour), UpdatedAt: now.Add(-24 * time.Hour), KeyVersion: 1,
			Grants:                []adapter.Grant{{Service: "fixture-module", State: adapter.MapGrant(true)}},
			InstallationsByStatus: map[string]int{adapter.StatusActive: 2, adapter.StatusPending: 1},
		}},
		ConnectionAudit: auditByConn,
		Health: adapter.Health{
			Revision:        "fixture-module",
			ContractVersion: adapter.ContractVersion,
			Capabilities:    []string{"accounts", "connections", "integrations", "audit"},
		},
	}
}

func moduleConnectionID(n int) string {
	return fmt.Sprintf("f2a00000-0000-4000-8000-%012d", n)
}
