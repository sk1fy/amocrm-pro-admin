package fixture

import (
	"context"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

func (a *Adapter) GetActivitySettings(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[adapter.ActivitySettings], error) {
	if err := a.require(ctx, a.caps.Settings); err != nil {
		return adapter.Observation[adapter.ActivitySettings]{}, err
	}
	if _, err := a.GetConnection(ctx, actor, id); err != nil {
		return adapter.Observation[adapter.ActivitySettings]{}, err
	}
	data := a.snapshot()
	settings, ok := data.ActivitySettings[id]
	if !ok {
		settings = adapter.ActivitySettings{InitialDays: 2, RetentionDays: 7}
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), settings), nil
}

func (a *Adapter) GetActivitySyncStatus(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[adapter.ActivitySyncStatus], error) {
	if err := a.require(ctx, a.caps.Settings); err != nil {
		return adapter.Observation[adapter.ActivitySyncStatus]{}, err
	}
	if _, err := a.GetConnection(ctx, actor, id); err != nil {
		return adapter.Observation[adapter.ActivitySyncStatus]{}, err
	}
	data := a.snapshot()
	status, ok := data.ActivitySync[id]
	if !ok {
		status = adapter.ActivitySyncStatus{State: adapter.MapSyncState(adapter.SyncNotEnabled)}
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), status), nil
}

func (a *Adapter) ListActivityPanels(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[[]adapter.ActivityPanel], error) {
	if err := a.require(ctx, a.caps.Settings); err != nil {
		return adapter.Observation[[]adapter.ActivityPanel]{}, err
	}
	if _, err := a.GetConnection(ctx, actor, id); err != nil {
		return adapter.Observation[[]adapter.ActivityPanel]{}, err
	}
	items := a.snapshot().ActivityPanels[id]
	if items == nil {
		items = []adapter.ActivityPanel{}
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), items), nil
}

func (a *Adapter) GetActivityPanel(ctx context.Context, actor adapter.Actor, id, panelID string) (adapter.Observation[adapter.ActivityPanel], error) {
	if err := a.require(ctx, a.caps.Settings); err != nil {
		return adapter.Observation[adapter.ActivityPanel]{}, err
	}
	if _, err := a.GetConnection(ctx, actor, id); err != nil {
		return adapter.Observation[adapter.ActivityPanel]{}, err
	}
	for _, panel := range a.snapshot().ActivityPanels[id] {
		if panel.ID == panelID {
			return adapter.Fresh(a.desc.Code, time.Now().UTC(), panel), nil
		}
	}
	return adapter.Observation[adapter.ActivityPanel]{}, adapter.NotFound(a.desc.Code, "panel not found")
}

func (a *Adapter) ListActivityEmployees(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[[]adapter.ActivityEmployee], error) {
	if err := a.require(ctx, a.caps.Settings); err != nil {
		return adapter.Observation[[]adapter.ActivityEmployee]{}, err
	}
	if _, err := a.GetConnection(ctx, actor, id); err != nil {
		return adapter.Observation[[]adapter.ActivityEmployee]{}, err
	}
	items := a.snapshot().ActivityEmployees[id]
	if items == nil {
		items = []adapter.ActivityEmployee{}
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), items), nil
}

func (a *Adapter) ListLeadStatusRules(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[[]adapter.LeadStatusRule], error) {
	if err := a.require(ctx, a.caps.Settings); err != nil {
		return adapter.Observation[[]adapter.LeadStatusRule]{}, err
	}
	if _, err := a.GetConnection(ctx, actor, id); err != nil {
		return adapter.Observation[[]adapter.LeadStatusRule]{}, err
	}
	items := a.snapshot().LeadStatusRules[id]
	if items == nil {
		items = []adapter.LeadStatusRule{}
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), items), nil
}

func (a *Adapter) ListLeadStatusRuns(ctx context.Context, actor adapter.Actor, id string, f adapter.PageFilter) (adapter.Observation[adapter.Page[adapter.LeadStatusRun]], error) {
	if err := a.require(ctx, a.caps.Settings); err != nil {
		return adapter.Observation[adapter.Page[adapter.LeadStatusRun]]{}, err
	}
	if _, err := a.GetConnection(ctx, actor, id); err != nil {
		return adapter.Observation[adapter.Page[adapter.LeadStatusRun]]{}, err
	}
	items := append([]adapter.LeadStatusRun{}, a.snapshot().LeadStatusRuns[id]...)
	page, err := paginate(items, f.Limit, f.Cursor, func(item adapter.LeadStatusRun) string { return item.ID })
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.LeadStatusRun]]{}, adapter.InvalidArgument(a.desc.Code, "invalid cursor")
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), page), nil
}

func (a *Adapter) GetStats(ctx context.Context, _ adapter.Actor, period string) (adapter.Observation[adapter.StatsSnapshot], error) {
	if err := a.require(ctx, a.caps.Stats); err != nil {
		return adapter.Observation[adapter.StatsSnapshot]{}, err
	}
	if period == "" {
		period = adapter.StatsPeriod24h
	}
	if !adapter.ValidStatsPeriod(period) {
		return adapter.Observation[adapter.StatsSnapshot]{}, adapter.InvalidArgument(a.desc.Code, "period must be 24h, 7d, or 30d")
	}
	snapshot, ok := a.snapshot().Stats[period]
	if !ok {
		snapshot = adapter.StatsSnapshot{Period: period, Connections: []adapter.StatsConnectionCount{}, Queues: []adapter.StatsQueueCount{}}
	}
	snapshot.Period = period
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), snapshot), nil
}

func (a *Adapter) ListStatsAccounts(ctx context.Context, _ adapter.Actor, f adapter.StatsAccountFilter) (adapter.Observation[adapter.Page[adapter.StatsAccount]], error) {
	if err := a.require(ctx, a.caps.Stats); err != nil {
		return adapter.Observation[adapter.Page[adapter.StatsAccount]]{}, err
	}
	key := f.Metric
	if f.Period != "" {
		key = f.Metric + ":" + f.Period
	}
	items := append([]adapter.StatsAccount{}, a.snapshot().StatsAccounts[key]...)
	if items == nil {
		items = a.snapshot().StatsAccounts[f.Metric]
	}
	if f.Product != "" {
		filtered := make([]adapter.StatsAccount, 0, len(items))
		for _, item := range items {
			if item.IntegrationCode == f.Product {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	page, err := paginate(items, f.Limit, f.Cursor, func(item adapter.StatsAccount) string {
		return item.InstallationID
	})
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.StatsAccount]]{}, adapter.InvalidArgument(a.desc.Code, "invalid cursor")
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), page), nil
}
