package fixture

import (
	"context"
	"encoding/base64"
	"strconv"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

const distributionEventID = "d1500000-0000-4000-8000-000000000001"
const distributionOperationID = "d1500000-0000-4000-8000-000000000002"
const distributionResultID = "d1500000-0000-4000-8000-000000000003"

func (a *Adapter) GetDistribution(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[adapter.DistributionSummary], error) {
	conn, err := a.GetConnection(ctx, actor, id)
	if err != nil {
		return adapter.Observation[adapter.DistributionSummary]{}, err
	}
	a.mu.RLock()
	paused := a.data.DistributionPaused[id]
	a.mu.RUnlock()
	now := time.Now().UTC()
	oldest := now.Add(-time.Minute)
	d := adapter.DistributionSummary{InstallationID: id, ModuleEnabled: true, Paused: paused, AuthorizationState: conn.Data.Authorization.State.Canonical, WebhookState: conn.Data.Webhook.Status.Canonical, WebhookCheckedAt: conn.Data.Webhook.CheckedAt, Origin: adapter.OriginFixture, TeamQueueState: adapter.StateUnknown,
		Binding: &adapter.DistributionBinding{ID: "d1500000-0000-4000-8000-000000000004", CompanyID: "d1500000-0000-4000-8000-000000000005", State: "active", Revision: 1, MappingRevision: 1, MappedEmployees: 3, ServiceAuthorized: true},
		Events:  adapter.DistributionBacklog{States: []adapter.DistributionCount{{State: "acknowledged", Count: 1}, {State: "pending", Count: 0}}}, Results: adapter.DistributionBacklog{States: []adapter.DistributionCount{{State: "blocked", Count: 1}}, OldestPendingAt: &oldest}, Operations: []adapter.DistributionCount{{State: "outcome_unknown", Count: 1}, {State: "succeeded", Count: 0}}, HistoricalGaps: 0}
	return adapter.Fresh(a.desc.Code, now, d), nil
}
func (a *Adapter) GetDistributionTrace(ctx context.Context, actor adapter.Actor, id string, f adapter.DistributionFilter) (adapter.Observation[adapter.DistributionTrace], error) {
	if _, err := a.GetConnection(ctx, actor, id); err != nil {
		return adapter.Observation[adapter.DistributionTrace]{}, err
	}
	now := time.Now().UTC()
	lead := "990001"
	v := int64(1)
	attempts := 3
	effect := "unknown"
	evidence := "readback_unconfirmed"
	code := "delivery_blocked"
	event, op, result := distributionEventID, distributionOperationID, distributionResultID
	items := []adapter.DistributionTraceItem{
		{Kind: "event", MessageID: &event, ID: event, State: "acknowledged", CreatedAt: now.Add(-3 * time.Minute), EventID: &event, LeadID: &lead, Attempts: &attempts},
		{Kind: "operation", ID: op, State: "outcome_unknown", CreatedAt: now.Add(-2 * time.Minute), EventID: &event, OperationID: &op, LeadID: &lead, ResultVersion: &v, ExternalEffectState: &effect, Evidence: &evidence},
		{Kind: "result", MessageID: &result, ID: op + ":1", State: "blocked", CreatedAt: now.Add(-time.Minute), ErrorCode: &code, EventID: &event, OperationID: &op, LeadID: &lead, ResultVersion: &v, Attempts: &attempts},
	}
	if f.Reference != "" && f.Reference != event && f.Reference != op && f.Reference != distributionResultID {
		items = []adapter.DistributionTraceItem{}
	}
	offset := 0
	if f.Cursor != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(f.Cursor)
		if err != nil {
			return adapter.Observation[adapter.DistributionTrace]{}, adapter.ErrInvalidArgument
		}
		i, err := strconv.Atoi(string(decoded))
		if err != nil || i < 0 || i > len(items) {
			return adapter.Observation[adapter.DistributionTrace]{}, adapter.ErrInvalidArgument
		}
		offset = i
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 25
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	var next *string
	if end < len(items) {
		cursor := base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(end)))
		next = &cursor
	}
	return adapter.Fresh(a.desc.Code, now, adapter.DistributionTrace{Items: items[offset:end], NextCursor: next}), nil
}
