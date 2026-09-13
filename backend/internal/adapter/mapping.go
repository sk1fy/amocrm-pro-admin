package adapter

import (
	"strings"
	"unicode/utf8"
)

const maxErrorRunes = 200

var (
	connectionStatuses = newSet(
		StatusPending, StatusAuthorizing, StatusActive, StatusReauthRequired,
		StatusDisabled, StatusUninstalled, StatusError,
	)
	webhookStatuses = newSet(
		StatusPending, StatusActive, StatusDisabled, StatusUnregistered, StatusError,
	)
	jobStatuses = newSet(
		StatusQueued, StatusProcessing, StatusRetry, StatusCompleted,
		StatusFailed, StatusDead, StatusCancelled,
	)
	jobOutcomes = newSet(
		StatusCompleted, StatusRetry, StatusFailed, StatusDead,
		StatusCancelled, StatusLeaseExpired,
	)
	integrationStatuses = newSet(StatusActive, StatusDisabled)
	outboxStatuses      = newSet(
		StatusPendingDelivery, StatusDelivering, StatusAccepted, StatusFailed, StatusExpired,
	)
	authStates = newSet(
		AuthMissing, AuthReauthRequired, AuthRefreshing, AuthExpiredRefreshable, AuthValid,
	)
	pilotStates = newSet(PilotEnabled, PilotDisabled, PilotNotConfigured)
	origins     = newSet(OriginFixture, OriginReal)
	syncStates  = newSet(
		SyncPending, SyncIdle, SyncRunning, SyncDisabled, SyncPaused,
		SyncFailed, SyncReauthRequired, SyncNotEnabled,
	)
	leadRunStatuses = newSet(
		LeadRunQueued, LeadRunProcessing, LeadRunCompleted, LeadRunFailed, LeadRunDead,
	)
	subscriptionStates = newSet(
		SubscriptionActive, SubscriptionTrial, SubscriptionExpired, SubscriptionCancelled,
	)
)

func MapConnectionStatus(raw string) State  { return mapKnown(raw, connectionStatuses) }
func MapWebhookStatus(raw string) State     { return mapKnown(raw, webhookStatuses) }
func MapJobStatus(raw string) State         { return mapKnown(raw, jobStatuses) }
func MapJobOutcome(raw string) State        { return mapKnown(raw, jobOutcomes) }
func MapIntegrationStatus(raw string) State { return mapKnown(raw, integrationStatuses) }
func MapOutboxStatus(raw string) State      { return mapKnown(raw, outboxStatuses) }
func MapAuthState(raw string) State         { return mapKnown(raw, authStates) }
func MapPilot(raw string) State             { return mapKnown(raw, pilotStates) }
func MapOrigin(raw string) State            { return mapKnown(raw, origins) }
func MapSyncState(raw string) State         { return mapKnown(raw, syncStates) }
func MapLeadStatusRun(raw string) State     { return mapKnown(raw, leadRunStatuses) }
func MapSubscriptionState(raw string) State { return mapKnown(raw, subscriptionStates) }

func MapGrant(enabled bool) State {
	if enabled {
		return State{Canonical: GrantGranted}
	}
	return State{Canonical: GrantNotGranted}
}

func mapKnown(raw string, known map[string]struct{}) State {
	if _, ok := known[raw]; ok {
		return State{Canonical: raw}
	}
	return State{Canonical: StateUnknown, Raw: raw}
}

func RedactError(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return value
	}
	if strings.Contains(value, "://") {
		if i := strings.Index(value, "?"); i >= 0 {
			value = value[:i]
		}
	}
	if utf8.RuneCountInString(value) <= maxErrorRunes {
		return value
	}
	runes := []rune(value)
	return string(runes[:maxErrorRunes])
}

func newSet(values ...string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		set[value] = struct{}{}
	}
	return set
}
