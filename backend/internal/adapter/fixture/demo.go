package fixture

import (
	"fmt"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

const (
	integrationACode = "fixture-widget-a"
	integrationBCode = "fixture-widget-b"
	integrationAID   = "0f1a0001-0000-4000-8000-000000000001"
	integrationBID   = "0f1a0001-0000-4000-8000-000000000002"
)

// Demo returns labelled fixture data matching deploy/fixtures/core-installations.sql:
// accounts 91000001–91000006, two widgets on 91000001 and 91000002
// (reauth vs active), connection ids f1a00000-0000-4000-8000-00000000000N.
func Demo(code string) *Adapter {
	return New(Options{Code: code, Data: demoData()})
}

func demoData() Data {
	now := time.Date(2026, 9, 12, 10, 0, 0, 0, time.UTC)
	id := installationID
	jobID := fixtureJobID
	userA := int64(501)
	userB := int64(502)
	userC := int64(503)
	userD := int64(504)
	userF := int64(506)
	redirect := "https://backend.example.invalid/oauth/amocrm/callback"
	reauthErr := "fixture: amoCRM responded 401 during subscription refresh"
	errorErr := "fixture: webhook registration rejected by amoCRM (400)"

	conn := func(n int, integrationID, code string, accountID int64, domain, status, webhook string, installedBy *int64, updated time.Time, auth string) adapter.ConnectionSummary {
		return adapter.ConnectionSummary{
			ID: id(n), IntegrationID: integrationID, IntegrationCode: code,
			AccountID: accountID, AccountDomain: domain,
			Status:        adapter.State{Canonical: status},
			WebhookStatus: adapter.State{Canonical: webhook},
			Authorization: adapter.State{Canonical: auth},
			Origin:        adapter.OriginFixture, InstalledBy: installedBy,
			CreatedAt: updated.Add(-24 * time.Hour), UpdatedAt: updated,
		}
	}

	c1 := conn(1, integrationAID, integrationACode, 91000001, "fixture-one.amocrm.test", adapter.StatusActive, adapter.StatusActive, &userA, now.Add(-10*time.Minute), adapter.AuthMissing)
	c1.Grants = []adapter.Grant{
		{Service: "lead-status", State: adapter.MapGrant(true)},
		{Service: "activity", State: adapter.MapGrant(true)},
	}
	c1.Pilot = adapter.State{Canonical: adapter.PilotEnabled}

	c2 := conn(2, integrationBID, integrationBCode, 91000001, "fixture-one.amocrm.test", adapter.StatusActive, adapter.StatusActive, &userA, now.Add(-12*time.Minute), adapter.AuthMissing)
	c2.Grants = []adapter.Grant{{Service: "lead-status", State: adapter.MapGrant(true)}}
	c2.Pilot = adapter.State{Canonical: adapter.PilotNotConfigured}

	c3 := conn(3, integrationAID, integrationACode, 91000002, "fixture-two.amocrm.test", adapter.StatusReauthRequired, adapter.StatusError, &userB, now, adapter.AuthReauthRequired)
	c3.Grants = []adapter.Grant{{Service: "lead-status", State: adapter.MapGrant(true)}}
	c3.Pilot = adapter.State{Canonical: adapter.PilotDisabled}

	c4 := conn(4, integrationBID, integrationBCode, 91000002, "fixture-two.amocrm.test", adapter.StatusActive, adapter.StatusActive, &userB, now.Add(-5*time.Minute), adapter.AuthMissing)
	c4.Grants = []adapter.Grant{{Service: "lead-status", State: adapter.MapGrant(true)}}
	c4.Pilot = adapter.State{Canonical: adapter.PilotNotConfigured}

	c5 := conn(5, integrationAID, integrationACode, 91000003, "fixture-three.amocrm.test", adapter.StatusDisabled, adapter.StatusActive, &userC, now.Add(-48*time.Hour), "")
	c5.Grants = []adapter.Grant{{Service: "lead-status", State: adapter.MapGrant(true)}}

	c6 := conn(6, integrationBID, integrationBCode, 91000004, "fixture-four.kommo.test", adapter.StatusUninstalled, adapter.StatusUnregistered, &userD, now.Add(-7*24*time.Hour), "")

	c7 := conn(7, integrationAID, integrationACode, 91000005, "fixture-five.amocrm.test", adapter.StatusPending, adapter.StatusPending, nil, now.Add(-2*time.Hour), adapter.AuthMissing)
	c7.Grants = []adapter.Grant{{Service: "lead-status", State: adapter.MapGrant(true)}}

	c8 := conn(8, integrationAID, integrationACode, 91000006, "fixture-six.amocrm.test", adapter.StatusError, adapter.StatusError, &userF, now.Add(-time.Hour), "")
	c8.Grants = []adapter.Grant{{Service: "lead-status", State: adapter.MapGrant(true)}}

	authUnverified := func(state string, present bool, version int64) adapter.Authorization {
		return adapter.Authorization{
			State: adapter.State{Canonical: state}, CredentialsPresent: present,
			CredentialVersion: version, Unverified: true,
		}
	}
	webhook := func(status string, events []string, checked *time.Time, last *string) adapter.Webhook {
		return adapter.Webhook{Status: adapter.State{Canonical: status}, Events: events, CheckedAt: checked, LastError: last}
	}
	checked1 := now.Add(-10 * time.Minute)
	checked2 := now.Add(-12 * time.Minute)
	checked3 := now.Add(-3 * time.Hour)
	checked4 := now.Add(-5 * time.Minute)
	checked5 := now.Add(-48 * time.Hour)
	checked6 := now.Add(-7 * 24 * time.Hour)
	checked8 := now.Add(-time.Hour)

	details := map[string]adapter.ConnectionDetail{
		c1.ID: {
			Connection: c1, Authorization: authUnverified(adapter.AuthMissing, false, 0),
			Webhook: webhook(adapter.StatusActive, []string{"add_lead", "status_lead"}, &checked1, nil),
			Grants:  c1.Grants, Activity: adapter.ActivityFacts{Pilot: c1.Pilot},
		},
		c2.ID: {
			Connection: c2, Authorization: authUnverified(adapter.AuthMissing, false, 0),
			Webhook: webhook(adapter.StatusActive, []string{"add_lead"}, &checked2, nil),
			Grants:  c2.Grants, Activity: adapter.ActivityFacts{Pilot: c2.Pilot},
		},
		c3.ID: {
			Connection: c3, Authorization: authUnverified(adapter.AuthReauthRequired, true, 3),
			Webhook: webhook(adapter.StatusError, []string{"add_lead", "status_lead"}, &checked3, &reauthErr),
			Grants:  c3.Grants, Activity: adapter.ActivityFacts{Pilot: c3.Pilot},
		},
		c4.ID: {
			Connection: c4, Authorization: authUnverified(adapter.AuthMissing, false, 0),
			Webhook: webhook(adapter.StatusActive, []string{"add_lead"}, &checked4, nil),
			Grants:  c4.Grants, Activity: adapter.ActivityFacts{Pilot: c4.Pilot},
		},
		c5.ID: {
			Connection: c5, Authorization: authUnverified(adapter.AuthMissing, false, 0),
			Webhook: webhook(adapter.StatusActive, []string{"status_lead"}, &checked5, nil),
			Grants:  c5.Grants,
		},
		c6.ID: {
			Connection: c6, Authorization: authUnverified(adapter.AuthMissing, false, 0),
			Webhook: webhook(adapter.StatusUnregistered, []string{}, &checked6, nil),
		},
		c7.ID: {
			Connection: c7, Authorization: authUnverified(adapter.AuthMissing, false, 0),
			Webhook: webhook(adapter.StatusPending, []string{}, nil, nil),
			Grants:  c7.Grants,
		},
		c8.ID: {
			Connection: c8, Authorization: authUnverified(adapter.AuthMissing, false, 0),
			Webhook: webhook(adapter.StatusError, []string{"add_lead"}, &checked8, &errorErr),
			Grants:  c8.Grants,
		},
	}

	failedMsg := "fixture: installation requires reauthorization"
	deadMsg := "fixture: amoCRM rejected webhook destination"
	retryMsg := "fixture: transient parse dependency failure"
	failedCode := "installation_not_active"
	deadCode := "amocrm_bad_request"
	retryCode := "temporary_failure"
	inst3, inst8, inst4, inst2, inst5 := c3.ID, c8.ID, c4.ID, c2.ID, c5.ID
	inst1 := c1.ID

	jobs := []adapter.JobDetail{
		{
			Job: adapter.Job{
				ID: jobID(1), InstallationID: &inst1, Type: "webhook.reconcile",
				Status: adapter.State{Canonical: adapter.StatusCompleted}, Attempts: 1, MaxAttempts: 5,
				RunAfter: now.Add(-10 * time.Minute), CreatedAt: now.Add(-10 * time.Minute),
				UpdatedAt: now.Add(-9 * time.Minute), FinishedAt: timePtr(now.Add(-9 * time.Minute)),
			},
			Attempts: []adapter.JobAttempt{{
				ID: 1, JobID: jobID(1), Attempt: 1, WorkerID: "fixture-worker",
				StartedAt: now.Add(-10 * time.Minute), FinishedAt: timePtr(now.Add(-9 * time.Minute)),
				Outcome: adapter.State{Canonical: adapter.StatusCompleted}, DurationMS: int64Ptr(850),
			}},
		},
		{
			Job: adapter.Job{
				ID: jobID(2), InstallationID: &inst3, Type: "webhook.reconcile",
				Status: adapter.State{Canonical: adapter.StatusFailed}, Attempts: 5, MaxAttempts: 5,
				RunAfter: now.Add(-3 * time.Hour), CreatedAt: now.Add(-3 * time.Hour),
				UpdatedAt: now.Add(-2 * time.Hour), FinishedAt: timePtr(now.Add(-2 * time.Hour)),
				LastErrorCode: &failedCode, LastErrorMessage: &failedMsg,
			},
			Attempts: []adapter.JobAttempt{{
				ID: 2, JobID: jobID(2), Attempt: 5, WorkerID: "fixture-worker",
				StartedAt: now.Add(-2 * time.Hour), FinishedAt: timePtr(now.Add(-2 * time.Hour)),
				Outcome:   adapter.State{Canonical: adapter.StatusFailed},
				ErrorCode: &failedCode, ErrorMessage: &failedMsg, DurationMS: int64Ptr(1980),
			}},
		},
		{
			Job: adapter.Job{
				ID: jobID(3), InstallationID: &inst8, Type: "webhook.reconcile",
				Status: adapter.State{Canonical: adapter.StatusDead}, Attempts: 5, MaxAttempts: 5,
				RunAfter: now.Add(-time.Hour), CreatedAt: now.Add(-time.Hour),
				UpdatedAt: now.Add(-30 * time.Minute), FinishedAt: timePtr(now.Add(-30 * time.Minute)),
				LastErrorCode: &deadCode, LastErrorMessage: &deadMsg,
			},
			Attempts: []adapter.JobAttempt{{
				ID: 3, JobID: jobID(3), Attempt: 5, WorkerID: "fixture-worker",
				StartedAt: now.Add(-31 * time.Minute), FinishedAt: timePtr(now.Add(-30 * time.Minute)),
				Outcome:   adapter.State{Canonical: adapter.StatusDead},
				ErrorCode: &deadCode, ErrorMessage: &deadMsg, DurationMS: int64Ptr(400),
			}},
		},
		{
			Job: adapter.Job{
				ID: jobID(4), InstallationID: &inst4, Type: "webhook.parse",
				Status: adapter.State{Canonical: adapter.StatusRetry}, Attempts: 2, MaxAttempts: 5,
				RunAfter: now.Add(2 * time.Minute), CreatedAt: now.Add(-6 * time.Minute),
				UpdatedAt: now.Add(-time.Minute), LastErrorCode: &retryCode, LastErrorMessage: &retryMsg,
			},
		},
		{
			Job: adapter.Job{
				ID: jobID(5), InstallationID: &inst2, Type: "webhook.parse",
				Status: adapter.State{Canonical: adapter.StatusQueued}, Attempts: 0, MaxAttempts: 5,
				RunAfter: now, CreatedAt: now.Add(-30 * time.Second), UpdatedAt: now.Add(-30 * time.Second),
			},
		},
		{
			Job: adapter.Job{
				ID: jobID(6), InstallationID: &inst5, Type: "webhook.reconcile",
				Status: adapter.State{Canonical: adapter.StatusCancelled}, Attempts: 0, MaxAttempts: 5,
				RunAfter: now.Add(-48 * time.Hour), CreatedAt: now.Add(-48 * time.Hour),
				UpdatedAt: now.Add(-48 * time.Hour), FinishedAt: timePtr(now.Add(-48 * time.Hour)),
			},
		},
	}
	installationAccount := map[string]int64{
		c1.ID: 91000001, c2.ID: 91000001,
		c3.ID: 91000002, c4.ID: 91000002,
		c5.ID: 91000003, c6.ID: 91000004, c7.ID: 91000005, c8.ID: 91000006,
	}
	connectionJobs := map[string][]adapter.Job{}
	recentFailures := map[string]int{}
	cutoff := now.Add(-24 * time.Hour)
	for i, detail := range jobs {
		if detail.Job.InstallationID == nil {
			continue
		}
		job := detail.Job
		if account, ok := installationAccount[*job.InstallationID]; ok {
			job.AccountID = &account
		}
		if (job.Status.Canonical == adapter.StatusFailed || job.Status.Canonical == adapter.StatusDead) &&
			!job.UpdatedAt.Before(cutoff) {
			recentFailures[*job.InstallationID]++
		}
		detail.Job = job
		jobs[i] = detail
		connectionJobs[*job.InstallationID] = append(connectionJobs[*job.InstallationID], job)
	}
	withFailures := func(conns ...adapter.ConnectionSummary) []adapter.ConnectionSummary {
		for i := range conns {
			conns[i].RecentFailedJobs = recentFailures[conns[i].ID]
		}
		return conns
	}

	actor := "fixture@example.invalid"
	seeded := func(conn adapter.ConnectionSummary, at time.Time, n int64) adapter.AuditEntry {
		cid := conn.ID
		return adapter.AuditEntry{
			ID: n, InstallationID: &cid, ActorType: "fixture", ActorID: &actor,
			Action: "installation.fixture_seeded", ObjectType: strPtr("installation"), ObjectID: &cid,
			Metadata: []byte(`{"origin":"fixture"}`), CreatedAt: at,
		}
	}
	reauthID := c3.ID
	auditByConn := map[string][]adapter.AuditEntry{
		c1.ID: {seeded(c1, now.Add(-time.Minute), 1)},
		c2.ID: {seeded(c2, now.Add(-time.Minute), 2)},
		c3.ID: {
			seeded(c3, now.Add(-time.Minute), 3),
			{
				ID: 10, InstallationID: &reauthID, ActorType: "fixture", ActorID: &actor,
				Action: "installation.reauth_required", ObjectType: strPtr("installation"), ObjectID: &reauthID,
				Metadata:  []byte(`{"origin":"fixture","reason":"amoCRM returned 401 twice during token refresh"}`),
				CreatedAt: now.Add(-3 * time.Hour),
			},
		},
		c4.ID: {seeded(c4, now.Add(-time.Minute), 4)},
		c5.ID: {seeded(c5, now.Add(-time.Minute), 5)},
		c6.ID: {seeded(c6, now.Add(-time.Minute), 6)},
		c7.ID: {seeded(c7, now.Add(-time.Minute), 7)},
		c8.ID: {seeded(c8, now.Add(-time.Minute), 8)},
	}

	return Data{
		Accounts: []adapter.Account{
			{AccountID: 91000001, Domains: []string{"fixture-one.amocrm.test"}, Origin: adapter.OriginFixture, LastActivityAt: c1.UpdatedAt, Connections: withFailures(c1, c2)},
			{AccountID: 91000002, Domains: []string{"fixture-two.amocrm.test"}, Origin: adapter.OriginFixture, LastActivityAt: c3.UpdatedAt, Connections: withFailures(c3, c4)},
			{AccountID: 91000003, Domains: []string{"fixture-three.amocrm.test"}, Origin: adapter.OriginFixture, LastActivityAt: c5.UpdatedAt, Connections: withFailures(c5)},
			{AccountID: 91000004, Domains: []string{"fixture-four.kommo.test"}, Origin: adapter.OriginFixture, LastActivityAt: c6.UpdatedAt, Connections: withFailures(c6)},
			{AccountID: 91000005, Domains: []string{"fixture-five.amocrm.test"}, Origin: adapter.OriginFixture, LastActivityAt: c7.UpdatedAt, Connections: withFailures(c7)},
			{AccountID: 91000006, Domains: []string{"fixture-six.amocrm.test"}, Origin: adapter.OriginFixture, LastActivityAt: c8.UpdatedAt, Connections: withFailures(c8)},
		},
		ConnectionDetails: details,
		Integrations: []adapter.Integration{
			{
				ID: integrationAID, Code: integrationACode, ClientID: integrationAID, RedirectURI: redirect,
				Status:        adapter.State{Canonical: adapter.StatusActive},
				WebhookEvents: []string{"add_lead", "status_lead"}, CreatedAt: now.Add(-30 * 24 * time.Hour),
				UpdatedAt: now.Add(-24 * time.Hour), KeyVersion: 1,
				Grants: []adapter.Grant{
					{Service: "lead-status", State: adapter.MapGrant(true)},
					{Service: "activity", State: adapter.MapGrant(true)},
				},
				InstallationsByStatus: map[string]int{
					adapter.StatusActive: 1, adapter.StatusReauthRequired: 1, adapter.StatusDisabled: 1,
					adapter.StatusPending: 1, adapter.StatusError: 1,
				},
			},
			{
				ID: integrationBID, Code: integrationBCode, ClientID: integrationBID, RedirectURI: redirect,
				Status:        adapter.State{Canonical: adapter.StatusActive},
				WebhookEvents: []string{"add_lead"}, CreatedAt: now.Add(-30 * 24 * time.Hour),
				UpdatedAt: now.Add(-24 * time.Hour), KeyVersion: 1,
				Grants: []adapter.Grant{{Service: "lead-status", State: adapter.MapGrant(true)}},
				InstallationsByStatus: map[string]int{
					adapter.StatusActive: 2, adapter.StatusUninstalled: 1,
				},
			},
		},
		Jobs:            jobs,
		ConnectionJobs:  connectionJobs,
		ConnectionAudit: auditByConn,
		Deliveries: map[string][]adapter.Delivery{
			c1.ID: {{
				CommandID: "f1c00000-0000-4000-8000-000000000001", InstallationID: c1.ID,
				Target: "activity", Action: "sync", Status: adapter.State{Canonical: adapter.StatusAccepted},
				Attempts: 1, MaxAttempts: 5, CreatedAt: now.Add(-2 * time.Hour), UpdatedAt: now.Add(-2 * time.Hour),
			}},
		},
		ActivitySettings: demoActivitySettings(c1.ID, now),
		ActivitySync:     demoActivitySync(c1.ID, c8.ID, now),
		ActivityPanels:   demoActivityPanels(c1.ID, now),
		ActivityEmployees: map[string][]adapter.ActivityEmployee{
			c1.ID: {
				{ID: 501, Name: "Fixture User A", GroupID: 1, GroupName: "Sales"},
				{ID: 502, Name: "Fixture User B", GroupID: 1, GroupName: "Sales"},
			},
		},
		LeadStatusRules: demoLeadStatusRules(c1.ID, now),
		LeadStatusRuns:  demoLeadStatusRuns(c1.ID, now),
		Stats:           demoStats(now),
		StatsAccounts:   demoStatsAccounts(),
	}
}

func demoActivitySettings(id string, now time.Time) map[string]adapter.ActivitySettings {
	updated := now.Add(-24 * time.Hour)
	return map[string]adapter.ActivitySettings{
		id: {InitialDays: 2, RetentionDays: 7, UpdatedAt: &updated},
	}
}

func demoActivitySync(idleID, unknownID string, now time.Time) map[string]adapter.ActivitySyncStatus {
	enabled := true
	lag := int64(12)
	from := now.Add(-7 * 24 * time.Hour)
	through := now.Add(-12 * time.Second)
	success := now.Add(-2 * time.Minute)
	event := now.Add(-12 * time.Second)
	return map[string]adapter.ActivitySyncStatus{
		idleID: {
			State: adapter.MapSyncState(adapter.SyncIdle), Verification: "stabilized_api_scan",
			Enabled: &enabled, VerifiedFrom: &from, VerifiedThrough: &through,
			LastSuccessAt: &success, LastEventAt: &event, LagSeconds: &lag,
		},
		unknownID: {
			State: adapter.MapSyncState("crm_events_unreachable"),
		},
	}
}

func demoActivityPanels(id string, now time.Time) map[string][]adapter.ActivityPanel {
	return map[string][]adapter.ActivityPanel{
		id: {{
			ID: "f1d00000-0000-4000-8000-000000000001", Name: "fixture-panel",
			EmployeeIDs: []int64{501, 502}, DisplayWindow: adapter.DisplayWindow{From: "09:00", To: "18:00"},
			Timezone: "Europe/Moscow", Enabled: true, Revision: 1, UpdatedAt: now.Add(-time.Hour), ShareURLIssued: true,
		}},
	}
}

func demoLeadStatusRules(id string, now time.Time) map[string][]adapter.LeadStatusRule {
	return map[string][]adapter.LeadStatusRule{
		id: {{
			ID:               "f1e00000-0000-4000-8000-000000000001",
			SourcePipelineID: 100, SourceStatusID: 101, TargetPipelineID: 200, TargetStatusID: 201,
			Enabled: true, Revision: 1, UpdatedAt: now.Add(-2 * time.Hour),
		}},
	}
}

func demoLeadStatusRuns(id string, now time.Time) map[string][]adapter.LeadStatusRun {
	finished := now.Add(-30 * time.Minute)
	return map[string][]adapter.LeadStatusRun{
		id: {
			{
				ID: "f1f00000-0000-4000-8000-000000000001", Status: adapter.MapLeadStatusRun(adapter.LeadRunCompleted),
				WorkflowType: "lead_status", EffectState: "applied", CreatedAt: now.Add(-40 * time.Minute), FinishedAt: &finished,
			},
			{
				ID: "f1f00000-0000-4000-8000-000000000002", Status: adapter.MapLeadStatusRun(adapter.LeadRunCompleted),
				WorkflowType: "lead_status", SkipReason: "status already matches target", CreatedAt: now.Add(-20 * time.Minute),
				FinishedAt: timePtr(now.Add(-19 * time.Minute)),
			},
		},
	}
}

func demoStats(now time.Time) map[string]adapter.StatsSnapshot {
	connected, disconnected, active, errors, auth, sync := 1, 0, 5, 2, 1, 0
	snapshot := adapter.StatsSnapshot{
		Period: adapter.StatsPeriod24h, PeriodStart: now.Add(-24 * time.Hour), PeriodEnd: now,
		Connections: []adapter.StatsConnectionCount{
			{Product: "activity", Status: adapter.StatusActive, Count: 1},
			{Product: "lead-status", Status: adapter.StatusActive, Count: 4},
			{Product: "lead-status", Status: adapter.StatusDisabled, Count: 1},
		},
		Connected: &connected, Disconnected: &disconnected, ActiveAccounts: &active,
		LastUseAt: timePtr(now.Add(-10 * time.Minute)), JobErrors: &errors, LatencyP50Ms: nil,
		Queues: []adapter.StatsQueueCount{
			{Type: "webhook.parse", Status: adapter.StatusQueued, Count: 1},
			{Type: "webhook.reconcile", Status: adapter.StatusFailed, Count: 1},
		},
		AuthProblems: &auth, SyncProblems: &sync,
	}
	week := snapshot
	week.Period = adapter.StatsPeriod7d
	week.PeriodStart = now.Add(-7 * 24 * time.Hour)
	month := snapshot
	month.Period = adapter.StatsPeriod30d
	month.PeriodStart = now.Add(-30 * 24 * time.Hour)
	return map[string]adapter.StatsSnapshot{
		adapter.StatsPeriod24h: snapshot,
		adapter.StatsPeriod7d:  week,
		adapter.StatsPeriod30d: month,
	}
}

func demoStatsAccounts() map[string][]adapter.StatsAccount {
	return map[string][]adapter.StatsAccount{
		"connected": {{
			AccountID: 91000001, Domain: "fixture-one.amocrm.test",
			InstallationID: installationID(1), IntegrationCode: integrationACode, Reason: "connected",
		}},
		"disconnected": {},
		"auth_problems": {{
			AccountID: 91000002, Domain: "fixture-two.amocrm.test",
			InstallationID: installationID(3), IntegrationCode: integrationACode, Reason: "reauth_required",
		}},
		"sync_problems": {{
			AccountID: 91000006, Domain: "fixture-six.amocrm.test",
			InstallationID: installationID(8), IntegrationCode: integrationACode, Reason: "unknown",
		}},
		"job_errors": {{
			AccountID: 91000002, Domain: "fixture-two.amocrm.test",
			InstallationID: installationID(3), IntegrationCode: integrationACode, Reason: "job_failures",
		}},
	}
}

func installationID(n int) string {
	return fmt.Sprintf("f1a00000-0000-4000-8000-%012d", n)
}

func fixtureJobID(n int) string {
	return fmt.Sprintf("f1b00000-0000-4000-8000-%012d", n)
}

func timePtr(value time.Time) *time.Time { return &value }

func int64Ptr(value int64) *int64 { return &value }

func strPtr(value string) *string { return &value }
