package adapter

import (
	"context"
	"regexp"
	"time"
)

// DistributionBackend is optional; absence is an unknown capability, not zero work.
type DistributionBackend interface {
	GetDistribution(context.Context, Actor, string) (Observation[DistributionSummary], error)
	GetDistributionTrace(context.Context, Actor, string, DistributionFilter) (Observation[DistributionTrace], error)
}

type DistributionFilter struct {
	Reference string
	PageFilter
}
type DistributionCount struct {
	State string `json:"state"`
	Raw   string `json:"raw,omitempty"`
	Count int    `json:"count"`
}
type DistributionBacklog struct {
	States          []DistributionCount `json:"states"`
	OldestPendingAt *time.Time          `json:"oldest_pending_at"`
}
type DistributionBinding struct {
	ID                string `json:"id"`
	CompanyID         string `json:"company_id"`
	State             string `json:"state"`
	Raw               string `json:"raw,omitempty"`
	Revision          int64  `json:"revision"`
	MappingRevision   int64  `json:"mapping_revision"`
	MappedEmployees   int    `json:"mapped_employees"`
	ServiceAuthorized bool   `json:"service_authorized"`
}
type DistributionSummary struct {
	InstallationID     string               `json:"installation_id"`
	ModuleEnabled      bool                 `json:"module_enabled"`
	Paused             bool                 `json:"paused"`
	AuthorizationState string               `json:"authorization_state"`
	AuthorizationRaw   string               `json:"authorization_raw,omitempty"`
	WebhookState       string               `json:"webhook_state"`
	WebhookRaw         string               `json:"webhook_raw,omitempty"`
	WebhookCheckedAt   *time.Time           `json:"webhook_checked_at"`
	Binding            *DistributionBinding `json:"binding"`
	Events             DistributionBacklog  `json:"events"`
	Results            DistributionBacklog  `json:"results"`
	Operations         []DistributionCount  `json:"operations"`
	HistoricalGaps     int                  `json:"historical_gaps"`
	TeamQueueState     string               `json:"team_queue_state"`
	Origin             string               `json:"origin"`
}
type DistributionTrace struct {
	Items      []DistributionTraceItem `json:"items"`
	NextCursor *string                 `json:"next_cursor"`
	Total      *int                    `json:"total"`
}
type DistributionTraceItem struct {
	MessageID           *string   `json:"message_id"`
	Kind                string    `json:"kind"`
	ID                  string    `json:"id"`
	State               string    `json:"state"`
	Raw                 string    `json:"raw,omitempty"`
	CreatedAt           time.Time `json:"created_at"`
	ErrorCode           *string   `json:"error_code"`
	EventID             *string   `json:"event_id"`
	OperationID         *string   `json:"operation_id"`
	CorrelationID       *string   `json:"correlation_id"`
	CausationID         *string   `json:"causation_id"`
	LeadID              *string   `json:"lead_id"`
	ResultVersion       *int64    `json:"result_version"`
	ExternalEffectState *string   `json:"external_effect_state"`
	Evidence            *string   `json:"evidence"`
	Attempts            *int      `json:"attempts"`
}

var safeDistributionCode = regexp.MustCompile(`^[a-zA-Z0-9_.:-]{1,64}$`)

func MapDistributionState(value string) State {
	switch value {
	case "pending", "processed", "ignored", "blocked", "delivering", "acknowledged", "queued", "prechecking", "applying", "confirming", "outcome_unknown", "succeeded", "no_change", "rejected", "conflict", "cancelled", "scanning", "completed", "active", "disabled", "revoked", "unknown":
		return State{Canonical: value}
	default:
		if !safeDistributionCode.MatchString(value) {
			value = "redacted"
		}
		return State{Canonical: StateUnknown, Raw: value}
	}
}
