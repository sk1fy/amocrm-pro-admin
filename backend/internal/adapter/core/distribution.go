package core

import (
	"context"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"net/url"
	"sort"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

type distributionCounts struct {
	States          map[string]int `json:"states"`
	OldestPendingAt *time.Time     `json:"oldest_pending_at"`
}
type distributionSummary struct {
	Source             string                       `json:"source"`
	ObservedAt         time.Time                    `json:"observed_at"`
	InstallationID     string                       `json:"installation_id"`
	ModuleEnabled      *bool                        `json:"module_enabled"`
	Paused             *bool                        `json:"paused"`
	AuthorizationState string                       `json:"authorization_state"`
	WebhookState       string                       `json:"webhook_state"`
	WebhookCheckedAt   *time.Time                   `json:"webhook_checked_at"`
	Binding            *adapter.DistributionBinding `json:"binding"`
	Events             distributionCounts           `json:"events"`
	Results            distributionCounts           `json:"results"`
	Operations         map[string]int               `json:"operations"`
	HistoricalGaps     *int                         `json:"historical_gaps"`
	TeamQueueState     string                       `json:"team_queue_state"`
}

func (c *Client) GetDistribution(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[adapter.DistributionSummary], error) {
	var wire distributionSummary
	if err := c.get(ctx, actor, "/admin/v1/installations/"+id+"/distribution", nil, &wire); err != nil {
		if errors.Is(err, adapter.ErrNotFound) {
			health, healthErr := c.Health(ctx, actor)
			if healthErr == nil && health.Data != nil {
				for _, capability := range health.Data.Capabilities {
					if capability == "distribution-read" {
						return adapter.Observation[adapter.DistributionSummary]{}, err
					}
				}
			}
			return adapter.UnknownObs[adapter.DistributionSummary](c.desc.Code, time.Now().UTC(), adapter.ErrorCodeUnsupported, "Источник не поддерживает диагностику распределения или установка недоступна"), nil
		}
		return adapter.Observation[adapter.DistributionSummary]{}, err
	}
	if wire.InstallationID != id || !validDistributionTime(wire.ObservedAt) || wire.ModuleEnabled == nil || wire.Paused == nil || wire.HistoricalGaps == nil || wire.Events.States == nil || wire.Results.States == nil || wire.Operations == nil {
		return adapter.Observation[adapter.DistributionSummary]{}, adapter.Unavailable(c.desc.Code, "Источник вернул неполные данные распределения")
	}
	for _, observed := range []*time.Time{wire.WebhookCheckedAt, wire.Events.OldestPendingAt, wire.Results.OldestPendingAt} {
		if observed != nil && !validDistributionTime(*observed) {
			return adapter.Observation[adapter.DistributionSummary]{}, adapter.ErrUnavailable
		}
	}
	if *wire.HistoricalGaps < 0 || !validDistributionCounts(wire.Events.States) || !validDistributionCounts(wire.Results.States) || !validDistributionCounts(wire.Operations) {
		return adapter.Observation[adapter.DistributionSummary]{}, adapter.Unavailable(c.desc.Code, "Источник вернул недопустимые счётчики распределения")
	}
	if wire.Binding != nil {
		if bindingID, e := uuid.Parse(wire.Binding.ID); e != nil || bindingID == uuid.Nil {
			return adapter.Observation[adapter.DistributionSummary]{}, adapter.ErrUnavailable
		}
		if companyID, e := uuid.Parse(wire.Binding.CompanyID); e != nil || companyID == uuid.Nil {
			return adapter.Observation[adapter.DistributionSummary]{}, adapter.ErrUnavailable
		}
		if wire.Binding.Revision < 0 || wire.Binding.MappingRevision < 0 || wire.Binding.MappedEmployees < 0 {
			return adapter.Observation[adapter.DistributionSummary]{}, adapter.ErrUnavailable
		}
	}
	auth, webhook := adapter.MapAuthState(wire.AuthorizationState), adapter.MapWebhookStatus(wire.WebhookState)
	if wire.Binding != nil {
		state := adapter.MapDistributionState(wire.Binding.State)
		wire.Binding.State = state.Canonical
		wire.Binding.Raw = state.Raw
	}
	data := adapter.DistributionSummary{InstallationID: id, ModuleEnabled: *wire.ModuleEnabled, Paused: *wire.Paused, AuthorizationState: auth.Canonical, AuthorizationRaw: auth.Raw, WebhookState: webhook.Canonical, WebhookRaw: webhook.Raw, WebhookCheckedAt: wire.WebhookCheckedAt, Binding: wire.Binding, Events: mapDistributionCounts(wire.Events), Results: mapDistributionCounts(wire.Results), Operations: mapDistributionStates(wire.Operations), HistoricalGaps: *wire.HistoricalGaps, TeamQueueState: adapter.StateUnknown, Origin: adapter.OriginReal}
	obs := adapter.Fresh(c.desc.Code, wire.ObservedAt, data)
	if time.Since(wire.ObservedAt) > 15*time.Minute {
		obs.Freshness = adapter.FreshnessStale
	}
	return obs, nil
}
func mapDistributionCounts(w distributionCounts) adapter.DistributionBacklog {
	return adapter.DistributionBacklog{States: mapDistributionStates(w.States), OldestPendingAt: w.OldestPendingAt}
}
func mapDistributionStates(w map[string]int) []adapter.DistributionCount {
	keys := make([]string, 0, len(w))
	for key := range w {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]adapter.DistributionCount, 0, len(keys))
	for _, key := range keys {
		state := adapter.MapDistributionState(key)
		out = append(out, adapter.DistributionCount{State: state.Canonical, Raw: state.Raw, Count: w[key]})
	}
	return out
}
func (c *Client) GetDistributionTrace(ctx context.Context, actor adapter.Actor, id string, f adapter.DistributionFilter) (adapter.Observation[adapter.DistributionTrace], error) {
	var wire struct {
		Source     string    `json:"source"`
		ObservedAt time.Time `json:"observed_at"`
		adapter.DistributionTrace
	}
	q := url.Values{}
	setLimitCursor(q, f.Limit, f.Cursor)
	setQuery(q, "reference", f.Reference)
	if err := c.get(ctx, actor, "/admin/v1/installations/"+id+"/distribution/trace", q, &wire); err != nil {
		if errors.Is(err, adapter.ErrNotFound) {
			health, healthErr := c.Health(ctx, actor)
			capable := false
			if healthErr == nil && health.Data != nil {
				for _, capability := range health.Data.Capabilities {
					if capability == "distribution-read" {
						capable = true
					}
				}
			}
			if !capable {
				return adapter.UnknownObs[adapter.DistributionTrace](c.desc.Code, time.Now().UTC(), adapter.ErrorCodeUnsupported, "Источник не поддерживает цепочку распределения"), nil
			}
		}
		return adapter.Observation[adapter.DistributionTrace]{}, err
	}
	if !validDistributionTime(wire.ObservedAt) || wire.Items == nil {
		return adapter.Observation[adapter.DistributionTrace]{}, adapter.Unavailable(c.desc.Code, "Источник вернул неполную цепочку распределения")
	}
	for i := range wire.Items {
		if err := validateDistributionItem(wire.Items[i]); err != nil {
			return adapter.Observation[adapter.DistributionTrace]{}, adapter.Unavailable(c.desc.Code, "Источник вернул недопустимую цепочку распределения")
		}
		s := adapter.MapDistributionState(wire.Items[i].State)
		wire.Items[i].State = s.Canonical
		wire.Items[i].Raw = s.Raw
		if wire.Items[i].ExternalEffectState != nil {
			switch *wire.Items[i].ExternalEffectState {
			case "no_attempt", "in_flight", "unknown", "settled":
			default:
				v := "unknown"
				wire.Items[i].ExternalEffectState = &v
			}
		}
	}
	obs := adapter.Fresh(c.desc.Code, wire.ObservedAt, wire.DistributionTrace)
	if time.Since(wire.ObservedAt) > 15*time.Minute {
		obs.Freshness = adapter.FreshnessStale
	}
	return obs, nil
}

func validDistributionTime(t time.Time) bool {
	return !t.IsZero() && !t.After(time.Now().UTC().Add(time.Minute))
}
func validDistributionCounts(m map[string]int) bool {
	for _, n := range m {
		if n < 0 {
			return false
		}
	}
	return true
}
func validateDistributionItem(i adapter.DistributionTraceItem) error {
	if i.ID == "" || i.Kind == "" || i.State == "" || !validDistributionTime(i.CreatedAt) {
		return fmt.Errorf("invalid trace identity")
	}
	if i.Attempts != nil && *i.Attempts < 0 || i.ResultVersion != nil && *i.ResultVersion < 0 {
		return fmt.Errorf("invalid trace counters")
	}
	for _, v := range []*string{i.MessageID, i.EventID, i.OperationID, i.CorrelationID, i.CausationID} {
		if v != nil {
			if _, err := uuid.Parse(*v); err != nil {
				return err
			}
		}
	}
	return nil
}
