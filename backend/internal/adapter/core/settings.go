package core

import (
	"context"
	"net/url"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

func (c *Client) GetActivitySettings(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[adapter.ActivitySettings], error) {
	var resp activitySettingsResponse
	if err := c.get(ctx, actor, "/admin/v1/installations/"+id+"/activity/settings", nil, &resp); err != nil {
		return adapter.Observation[adapter.ActivitySettings]{}, err
	}
	var updated *time.Time
	if resp.UpdatedAt > 0 {
		value := time.Unix(resp.UpdatedAt, 0).UTC()
		updated = &value
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, adapter.ActivitySettings{
		InitialDays: resp.InitialDays, RetentionDays: resp.RetentionDays, UpdatedAt: updated,
	}), nil
}

func (c *Client) GetActivitySyncStatus(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[adapter.ActivitySyncStatus], error) {
	var resp activityStatusResponse
	if err := c.get(ctx, actor, "/admin/v1/installations/"+id+"/activity/status", nil, &resp); err != nil {
		return adapter.Observation[adapter.ActivitySyncStatus]{}, err
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, adapter.ActivitySyncStatus{
		State: adapter.MapSyncState(resp.State), Verification: resp.Verification, Enabled: resp.Enabled,
		VerifiedFrom: resp.VerifiedFrom, VerifiedThrough: resp.VerifiedThrough,
		LastSuccessAt: resp.LastSuccessAt, LastEventAt: resp.LastEventAt, LagSeconds: resp.LagSeconds,
		ErrorCode: resp.ErrorCode, ReauthRequired: resp.ReauthRequired,
	}), nil
}

func (c *Client) ListActivityPanels(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[[]adapter.ActivityPanel], error) {
	var resp activityPanelsResponse
	if err := c.get(ctx, actor, "/admin/v1/installations/"+id+"/activity/panels", nil, &resp); err != nil {
		return adapter.Observation[[]adapter.ActivityPanel]{}, err
	}
	items := make([]adapter.ActivityPanel, 0, len(resp.Items))
	for _, item := range resp.Items {
		items = append(items, mapPanel(item))
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, items), nil
}

func (c *Client) GetActivityPanel(ctx context.Context, actor adapter.Actor, id, panelID string) (adapter.Observation[adapter.ActivityPanel], error) {
	var resp activityPanelResponse
	if err := c.get(ctx, actor, "/admin/v1/installations/"+id+"/activity/panels/"+panelID, nil, &resp); err != nil {
		return adapter.Observation[adapter.ActivityPanel]{}, err
	}
	panel := resp.activityPanel
	if resp.Panel != nil && resp.Panel.ID != "" {
		panel = *resp.Panel
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, mapPanel(panel)), nil
}

func (c *Client) ListActivityEmployees(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[[]adapter.ActivityEmployee], error) {
	var resp activityEmployeesResponse
	if err := c.get(ctx, actor, "/admin/v1/installations/"+id+"/activity/employees", nil, &resp); err != nil {
		return adapter.Observation[[]adapter.ActivityEmployee]{}, err
	}
	raw := resp.Items
	if len(raw) == 0 {
		raw = resp.Users
	}
	items := make([]adapter.ActivityEmployee, 0, len(raw))
	for _, item := range raw {
		items = append(items, adapter.ActivityEmployee{
			ID: item.ID, Name: item.Name, GroupID: item.GroupID, GroupName: item.GroupName,
		})
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, items), nil
}

func (c *Client) ListLeadStatusRules(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[[]adapter.LeadStatusRule], error) {
	var resp leadStatusRulesResponse
	if err := c.get(ctx, actor, "/admin/v1/installations/"+id+"/lead-status/rules", nil, &resp); err != nil {
		return adapter.Observation[[]adapter.LeadStatusRule]{}, err
	}
	items := make([]adapter.LeadStatusRule, 0, len(resp.Items))
	for _, item := range resp.Items {
		items = append(items, adapter.LeadStatusRule{
			ID: item.ID, SourcePipelineID: item.SourcePipelineID, SourceStatusID: item.SourceStatusID,
			TargetPipelineID: item.TargetPipelineID, TargetStatusID: item.TargetStatusID,
			Enabled: item.Enabled, Revision: item.Revision, UpdatedAt: item.UpdatedAt.UTC(),
		})
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, items), nil
}

func (c *Client) ListLeadStatusRuns(ctx context.Context, actor adapter.Actor, id string, f adapter.PageFilter) (adapter.Observation[adapter.Page[adapter.LeadStatusRun]], error) {
	query := url.Values{}
	setLimitCursor(query, f.Limit, f.Cursor)
	var envelope listEnvelope
	if err := c.get(ctx, actor, "/admin/v1/installations/"+id+"/lead-status/runs", query, &envelope); err != nil {
		return adapter.Observation[adapter.Page[adapter.LeadStatusRun]]{}, err
	}
	raw, err := decodeList[leadStatusRun](envelope.Items)
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.LeadStatusRun]]{}, adapter.Unavailable(c.desc.Code, "core returned invalid json")
	}
	items := make([]adapter.LeadStatusRun, 0, len(raw))
	for _, item := range raw {
		errorReason := item.ErrorReason
		if errorReason == "" && item.EffectError != nil {
			errorReason = *item.EffectError
		}
		skipReason := item.SkipReason
		if skipReason == "" && (item.EffectState == "source_changed" || item.EffectState == "already_converged") {
			skipReason = item.EffectState
		}
		items = append(items, adapter.LeadStatusRun{
			ID: item.ID, Status: adapter.MapLeadStatusRun(item.Status), WorkflowType: item.WorkflowType,
			SkipReason: skipReason, ErrorReason: errorReason, EffectState: item.EffectState,
			CreatedAt: item.CreatedAt.UTC(), FinishedAt: item.FinishedAt,
		})
	}
	return adapter.Fresh(c.desc.Code, envelope.ObservedAt, adapter.Page[adapter.LeadStatusRun]{
		Items: items, NextCursor: envelope.NextCursor, Total: envelope.Total,
	}), nil
}

func (c *Client) GetStats(ctx context.Context, actor adapter.Actor, period string) (adapter.Observation[adapter.StatsSnapshot], error) {
	query := url.Values{}
	setQuery(query, "period", period)
	var resp statsResponse
	if err := c.get(ctx, actor, "/admin/v1/stats", query, &resp); err != nil {
		return adapter.Observation[adapter.StatsSnapshot]{}, err
	}
	connections := make([]adapter.StatsConnectionCount, 0, len(resp.Connections))
	for _, item := range resp.Connections {
		product := item.Product
		if product == "" {
			product = item.IntegrationCode
		}
		connections = append(connections, adapter.StatsConnectionCount{Product: product, Status: item.Status, Count: item.Count})
	}
	queues := resp.Queues
	if queues == nil {
		queues = []adapter.StatsQueueCount{}
	}
	start, end := resp.PeriodStart, resp.PeriodEnd
	if start.IsZero() {
		start = resp.From
	}
	if end.IsZero() {
		end = resp.To
	}
	connected := firstInt(resp.Connected, resp.PeriodEvents.Connected)
	disconnected := firstInt(resp.Disconnected, resp.PeriodEvents.Disconnected)
	auth := firstInt(resp.AuthProblems, resp.AuthProblemsCount)
	sync := firstInt(resp.SyncProblems, resp.SyncProblemsCount)
	latency := resp.LatencyP50Ms
	if latency == nil && resp.Latency.P50MS != nil {
		value := int64(*resp.Latency.P50MS)
		latency = &value
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, adapter.StatsSnapshot{
		Verification: resp.Verification,
		Period:       resp.Period, PeriodStart: start.UTC(), PeriodEnd: end.UTC(),
		Connections: connections, Connected: connected, Disconnected: disconnected,
		ActiveAccounts: resp.ActiveAccounts, LastUseAt: resp.LastUseAt, JobErrors: resp.JobErrors,
		LatencyP50Ms: latency, Queues: queues, AuthProblems: auth, SyncProblems: sync,
	}), nil
}

func firstInt(flat *int, nested *int64) *int {
	if flat != nil {
		return flat
	}
	if nested == nil {
		return nil
	}
	value := int(*nested)
	return &value
}

func (c *Client) ListStatsAccounts(ctx context.Context, actor adapter.Actor, f adapter.StatsAccountFilter) (adapter.Observation[adapter.Page[adapter.StatsAccount]], error) {
	query := url.Values{}
	setQuery(query, "metric", f.Metric)
	setQuery(query, "period", f.Period)
	setQuery(query, "product", f.Product)
	setLimitCursor(query, f.Limit, f.Cursor)
	var envelope listEnvelope
	if err := c.get(ctx, actor, "/admin/v1/stats/accounts", query, &envelope); err != nil {
		return adapter.Observation[adapter.Page[adapter.StatsAccount]]{}, err
	}
	raw, err := decodeList[statsAccount](envelope.Items)
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.StatsAccount]]{}, adapter.Unavailable(c.desc.Code, "core returned invalid json")
	}
	items := make([]adapter.StatsAccount, 0, len(raw))
	for _, item := range raw {
		items = append(items, adapter.StatsAccount{
			AccountID: item.AccountID, Domain: item.Domain, InstallationID: item.InstallationID,
			IntegrationCode: item.IntegrationCode, Reason: item.Reason,
		})
	}
	return adapter.Fresh(c.desc.Code, envelope.ObservedAt, adapter.Page[adapter.StatsAccount]{
		Items: items, NextCursor: envelope.NextCursor, Total: envelope.Total,
	}), nil
}

func mapPanel(item activityPanel) adapter.ActivityPanel {
	ids := item.EmployeeIDs
	if ids == nil {
		ids = []int64{}
	}
	return adapter.ActivityPanel{
		ID: item.ID, Name: item.Name, EmployeeIDs: ids, DisplayWindow: item.DisplayWindow,
		Timezone: item.Timezone, Enabled: item.Enabled, Revision: item.Revision,
		UpdatedAt: item.UpdatedAt.UTC(), ShareURLIssued: item.ShareURLIssued,
	}
}
