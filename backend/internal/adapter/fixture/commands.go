package fixture

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

type commandReceipt struct {
	hash    [32]byte
	command string
	result  adapter.CommandResult
}

type commandPayload struct {
	Enabled           *bool                 `json:"enabled"`
	ExpectedUpdatedAt *int64                `json:"expected_updated_at"`
	ExpectedRevision  *int64                `json:"expected_revision"`
	DisplayWindow     adapter.DisplayWindow `json:"display_window"`
	Code              string                `json:"code"`
	ClientID          string                `json:"client_id"`
	Secret            string                `json:"client_secret"`
	RedirectURI       string                `json:"redirect_uri"`
	Service           string                `json:"service"`
	InstallationID    string                `json:"installation_id"`
	Kind              string                `json:"kind"`
	From              int64                 `json:"from"`
	To                int64                 `json:"to"`
	PanelID           string                `json:"panel_id"`
	Name              string                `json:"name"`
	RuleID            string                `json:"rule_id"`
	WebhookEvents     []string              `json:"webhook_events"`
	Services          []string              `json:"services"`
	EmployeeIDs       []int64               `json:"employee_ids"`
	InitialDays       int                   `json:"initial_days"`
	RetentionDays     int                   `json:"retention_days"`
	Revision          int64                 `json:"revision"`
	SourcePipelineID  int64                 `json:"source_pipeline_id"`
	SourceStatusID    int64                 `json:"source_status_id"`
	TargetPipelineID  int64                 `json:"target_pipeline_id"`
	TargetStatusID    int64                 `json:"target_status_id"`
	ServiceEnabled    bool                  `json:"-"`
	HasServiceEnabled bool                  `json:"-"`
}

func (a *Adapter) snapshot() Data {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return cloneData(a.data)
}
func cloneData(source Data) Data {
	out := source
	out.Accounts = append([]adapter.Account{}, source.Accounts...)
	for i := range out.Accounts {
		out.Accounts[i].Connections = append([]adapter.ConnectionSummary{}, source.Accounts[i].Connections...)
	}
	out.ConnectionDetails = map[string]adapter.ConnectionDetail{}
	for id, v := range source.ConnectionDetails {
		out.ConnectionDetails[id] = v
	}
	out.Integrations = append([]adapter.Integration{}, source.Integrations...)
	for i := range out.Integrations {
		out.Integrations[i].Grants = append([]adapter.Grant{}, source.Integrations[i].Grants...)
	}
	out.Jobs = append([]adapter.JobDetail{}, source.Jobs...)
	out.ConnectionJobs = map[string][]adapter.Job{}
	for id, v := range source.ConnectionJobs {
		out.ConnectionJobs[id] = append([]adapter.Job{}, v...)
	}
	out.ConnectionAudit = map[string][]adapter.AuditEntry{}
	for id, v := range source.ConnectionAudit {
		out.ConnectionAudit[id] = append([]adapter.AuditEntry{}, v...)
	}
	out.Deliveries = map[string][]adapter.Delivery{}
	for id, v := range source.Deliveries {
		out.Deliveries[id] = append([]adapter.Delivery{}, v...)
	}
	out.ActivitySettings = map[string]adapter.ActivitySettings{}
	for id, v := range source.ActivitySettings {
		out.ActivitySettings[id] = v
	}
	out.ActivitySync = map[string]adapter.ActivitySyncStatus{}
	for id, v := range source.ActivitySync {
		status := v
		if v.Enabled != nil {
			enabled := *v.Enabled
			status.Enabled = &enabled
		}
		if v.LagSeconds != nil {
			lag := *v.LagSeconds
			status.LagSeconds = &lag
		}
		out.ActivitySync[id] = status
	}
	out.ActivityPanels = map[string][]adapter.ActivityPanel{}
	for id, v := range source.ActivityPanels {
		cloned := make([]adapter.ActivityPanel, len(v))
		copy(cloned, v)
		for i := range cloned {
			cloned[i].EmployeeIDs = append([]int64{}, v[i].EmployeeIDs...)
		}
		out.ActivityPanels[id] = cloned
	}
	out.ActivityEmployees = map[string][]adapter.ActivityEmployee{}
	for id, v := range source.ActivityEmployees {
		out.ActivityEmployees[id] = append([]adapter.ActivityEmployee{}, v...)
	}
	out.LeadStatusRules = map[string][]adapter.LeadStatusRule{}
	for id, v := range source.LeadStatusRules {
		out.LeadStatusRules[id] = append([]adapter.LeadStatusRule{}, v...)
	}
	out.LeadStatusRuns = map[string][]adapter.LeadStatusRun{}
	for id, v := range source.LeadStatusRuns {
		out.LeadStatusRuns[id] = append([]adapter.LeadStatusRun{}, v...)
	}
	out.Stats = map[string]adapter.StatsSnapshot{}
	for id, v := range source.Stats {
		out.Stats[id] = v
	}
	out.StatsAccounts = map[string][]adapter.StatsAccount{}
	for id, v := range source.StatsAccounts {
		out.StatsAccounts[id] = append([]adapter.StatsAccount{}, v...)
	}
	return out
}
func (a *Adapter) GetCommand(ctx context.Context, _ adapter.Actor, id string) (adapter.CommandResult, error) {
	if err := a.require(ctx, a.caps.Commands); err != nil {
		return adapter.CommandResult{}, err
	}
	a.commandMu.Lock()
	defer a.commandMu.Unlock()
	receipt, ok := a.commands[id]
	if !ok {
		return adapter.CommandResult{}, adapter.ErrNotFound
	}
	if receipt.command == "activity-sync" && receipt.result.State == "pending" {
		receipt.result.State = "succeeded"
		receipt.result.Outcome = "ok"
		a.commands[id] = receipt
	}
	return receipt.result, nil
}
func (a *Adapter) ExecuteCommand(ctx context.Context, _ adapter.Actor, key string, request adapter.CommandRequest) (adapter.CommandResult, error) {
	if err := a.require(ctx, a.caps.Commands); err != nil {
		return adapter.CommandResult{}, err
	}
	a.commandMu.Lock()
	defer a.commandMu.Unlock()
	raw, err := json.Marshal(request)
	if err != nil {
		return adapter.CommandResult{}, adapter.ErrInvalidArgument
	}
	hash := sha256.Sum256(raw)
	if old, ok := a.commands[key]; ok {
		if old.hash != hash {
			return adapter.CommandResult{}, adapter.ErrConflict
		}
		return old.result, nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.data = cloneData(a.data)
	now := time.Now().UTC()
	result := adapter.CommandResult{ID: key, State: "succeeded", Outcome: "ok", ObservedAt: now, Result: map[string]any{"observed_at": now.Format(time.RFC3339Nano)}}
	var payload commandPayload
	if raw := request.Payload; len(raw) > 0 {
		var probe map[string]json.RawMessage
		if json.Unmarshal(raw, &probe) == nil {
			if value, ok := probe["enabled"]; ok {
				payload.HasServiceEnabled = true
				_ = json.Unmarshal(value, &payload.ServiceEnabled)
			}
		}
	}
	if json.Unmarshal(request.Payload, &payload) != nil {
		return result, adapter.ErrInvalidArgument
	}
	switch request.TargetType {
	case "installation":
		found := false
		for i := range a.data.Accounts {
			for j := range a.data.Accounts[i].Connections {
				conn := &a.data.Accounts[i].Connections[j]
				if conn.ID != request.TargetID {
					continue
				}
				found = true
				switch request.Command {
				case "enable":
					if conn.Status.Canonical != adapter.StatusDisabled {
						return result, adapter.ErrConflict
					}
					conn.Status = adapter.MapConnectionStatus("active")
				case "disable":
					if conn.Status.Canonical == adapter.StatusUninstalled {
						return result, adapter.ErrConflict
					}
					conn.Status = adapter.MapConnectionStatus("disabled")
				case "revoke":
					if conn.Status.Canonical == adapter.StatusDisabled || conn.Status.Canonical == adapter.StatusUninstalled {
						return result, adapter.ErrConflict
					}
					conn.Status = adapter.MapConnectionStatus("reauth_required")
					conn.Authorization = adapter.MapAuthState("reauth_required")
					result.Result["oauth_start_url"] = "https://backend.example.invalid/oauth/amocrm/start?client_id=" + conn.IntegrationID
				case "uninstall":
					partial := conn.Status.Canonical != adapter.StatusUninstalled && conn.WebhookStatus.Canonical == adapter.StatusError
					conn.Status = adapter.MapConnectionStatus("uninstalled")
					conn.Authorization = adapter.MapAuthState("missing")
					if partial {
						result.State = "partial"
						result.Result["webhook_error"] = "fixture webhook removal failed"
					} else {
						conn.WebhookStatus = adapter.MapWebhookStatus("unregistered")
					}
				case "check":
					classification := "verified_ok"
					if conn.Authorization.Canonical == adapter.AuthMissing || conn.Authorization.Canonical == adapter.AuthReauthRequired {
						classification = "auth_error"
					}
					result.Outcome = classification
					result.Result["classification"] = classification
				case "reconcile":
					conn.WebhookStatus = adapter.MapWebhookStatus("active")
				case "pilot-enable":
					conn.Pilot = adapter.MapPilot("enabled")
				case "pilot-disable":
					conn.Pilot = adapter.MapPilot("disabled")
				case "activity-configure":
					applied, err := a.applyActivityConfigure(conn.ID, payload, now)
					if err != nil {
						return adapter.CommandResult{ID: key, State: "failed", Result: applied, ObservedAt: now}, err
					}
					result.Result["initial_days"] = applied["initial_days"]
					result.Result["retention_days"] = applied["retention_days"]
					result.Result["updated_at"] = applied["updated_at"]
				case "activity-sync":
					switch payload.Kind {
					case "enable", "disable", "backfill", "sync":
					default:
						return result, adapter.ErrInvalidArgument
					}
					result.Result["kind"] = payload.Kind
					result.Result["operation_id"] = key
					if payload.From != 0 {
						result.Result["from"] = payload.From
					}
					if payload.To != 0 {
						result.Result["to"] = payload.To
					}
					if payload.Kind == "sync" {
						result.State = "pending"
						result.Outcome = ""
					}
					if payload.Kind == "enable" || payload.Kind == "disable" {
						enabled := payload.Kind == "enable"
						status := a.data.ActivitySync[conn.ID]
						status.Enabled = &enabled
						if payload.Kind == "enable" {
							status.State = adapter.MapSyncState(adapter.SyncIdle)
						} else {
							status.State = adapter.MapSyncState(adapter.SyncDisabled)
						}
						a.data.ActivitySync[conn.ID] = status
						result.Result["enabled"] = enabled
						result.Result["state"] = status.State.Canonical
					}
				case "activity-panel-create", "activity-panel-patch", "activity-panel-rotate":
					applied, err := a.applyActivityPanel(conn.ID, request.Command, payload, now)
					if err != nil {
						return adapter.CommandResult{ID: key, State: "failed", Result: applied, ObservedAt: now}, err
					}
					for k, v := range applied {
						result.Result[k] = v
					}
				case "lead-status-configure":
					applied, err := a.applyLeadStatus(conn.ID, payload, now)
					if err != nil {
						return adapter.CommandResult{ID: key, State: "failed", Result: applied, ObservedAt: now}, err
					}
					for k, v := range applied {
						result.Result[k] = v
					}
				default:
					return result, adapter.ErrInvalidArgument
				}
				conn.UpdatedAt = now
				if detail, ok := a.data.ConnectionDetails[conn.ID]; ok {
					detail.Connection = *conn
					detail.Authorization.State = conn.Authorization
					detail.Authorization.Unverified = true
					detail.Webhook.Status = conn.WebhookStatus
					detail.Activity.Pilot = conn.Pilot
					a.data.ConnectionDetails[conn.ID] = detail
				}
				result.Result["installation_id"] = conn.ID
				result.Result["status"] = conn.Status.Canonical
			}
		}
		if !found {
			return result, adapter.ErrNotFound
		}
	case "integration":
		if request.Command == "create" {
			if payload.Code == "" || payload.ClientID == "" || payload.Secret == "" || payload.RedirectURI == "" {
				return result, adapter.ErrInvalidArgument
			}
			for _, v := range a.data.Integrations {
				if v.Code == payload.Code || v.ClientID == payload.ClientID {
					return result, adapter.ErrConflict
				}
			}
			item := adapter.Integration{ID: uuid.NewString(), Code: payload.Code, ClientID: payload.ClientID, RedirectURI: payload.RedirectURI, Status: adapter.MapIntegrationStatus("active"), CreatedAt: now, UpdatedAt: now, KeyVersion: 1, WebhookEvents: payload.WebhookEvents, Grants: []adapter.Grant{}}
			for _, service := range payload.Services {
				item.Grants = append(item.Grants, adapter.Grant{Service: service, State: adapter.MapGrant(true)})
			}
			a.data.Integrations = append(a.data.Integrations, item)
			result.Result["integration_id"] = item.ID
		} else {
			found := false
			for i := range a.data.Integrations {
				item := &a.data.Integrations[i]
				if item.ID != request.TargetID {
					continue
				}
				found = true
				switch request.Command {
				case "enable", "disable":
					state := "active"
					if request.Command == "disable" {
						state = "disabled"
					}
					item.Status = adapter.MapIntegrationStatus(state)
				case "update":
					if payload.RedirectURI != "" {
						item.RedirectURI = payload.RedirectURI
					}
					if payload.WebhookEvents != nil {
						item.WebhookEvents = payload.WebhookEvents
					}
				case "rotate-secret":
					if payload.Secret == "" {
						return result, adapter.ErrInvalidArgument
					}
					item.KeyVersion++
				case "set-service":
					if payload.Service != "activity" && payload.Service != "lead-status" {
						return result, adapter.ErrInvalidArgument
					}
					enabled := payload.ServiceEnabled
					if !payload.HasServiceEnabled && payload.Enabled != nil {
						enabled = *payload.Enabled
					}
					foundGrant := false
					for j := range item.Grants {
						if item.Grants[j].Service == payload.Service {
							item.Grants[j].State = adapter.MapGrant(enabled)
							foundGrant = true
						}
					}
					if !foundGrant {
						item.Grants = append(item.Grants, adapter.Grant{Service: payload.Service, State: adapter.MapGrant(enabled)})
					}
				default:
					return result, adapter.ErrInvalidArgument
				}
				if request.Command == "set-service" {
					for ai := range a.data.Accounts {
						for ci := range a.data.Accounts[ai].Connections {
							conn := &a.data.Accounts[ai].Connections[ci]
							if conn.IntegrationID != item.ID {
								continue
							}
							conn.Grants = append([]adapter.Grant{}, item.Grants...)
							if detail, ok := a.data.ConnectionDetails[conn.ID]; ok {
								detail.Connection = *conn
								detail.Grants = append([]adapter.Grant{}, item.Grants...)
								a.data.ConnectionDetails[conn.ID] = detail
							}
						}
					}
				}
				item.UpdatedAt = now
				result.Result["integration_id"] = item.ID
				result.Result["status"] = item.Status.Canonical
			}
			if !found {
				return result, adapter.ErrNotFound
			}
		}
	case "job":
		found := false
		for connID, jobs := range a.data.ConnectionJobs {
			for i := range jobs {
				if jobs[i].ID == request.TargetID {
					if !fixtureRetryAllowed(jobs[i]) {
						return result, adapter.ErrConflict
					}
					jobs[i].Status = adapter.MapJobStatus("queued")
					jobs[i].UpdatedAt = now
					found = true
				}
			}
			a.data.ConnectionJobs[connID] = jobs
		}
		for i := range a.data.Jobs {
			if a.data.Jobs[i].Job.ID == request.TargetID {
				if !found && !fixtureRetryAllowed(a.data.Jobs[i].Job) {
					return result, adapter.ErrConflict
				}
				a.data.Jobs[i].Job.Status = adapter.MapJobStatus("queued")
				a.data.Jobs[i].Job.UpdatedAt = now
				found = true
			}
		}
		if !found {
			return result, adapter.ErrNotFound
		}
		result.Result["job_id"] = request.TargetID
	case "delivery":
		found := false
		for connID, items := range a.data.Deliveries {
			if connID != payload.InstallationID {
				continue
			}
			for i := range items {
				if items[i].CommandID == request.TargetID {
					if items[i].Status.Canonical != "failed" || time.Since(items[i].CreatedAt) > 7*24*time.Hour {
						return result, adapter.ErrConflict
					}
					items[i].Status = adapter.MapOutboxStatus("pending_delivery")
					found = true
				}
			}
			a.data.Deliveries[connID] = items
		}
		if !found {
			return result, adapter.ErrNotFound
		}
	default:
		return result, adapter.ErrInvalidArgument
	}
	if a.commands == nil {
		a.commands = map[string]commandReceipt{}
	}
	a.commands[key] = commandReceipt{hash: hash, command: request.Command, result: result}
	return result, nil
}

func settingsCurrent(settings adapter.ActivitySettings) map[string]any {
	updated := int64(0)
	if settings.UpdatedAt != nil {
		updated = settings.UpdatedAt.Unix()
	}
	return map[string]any{
		"initial_days": settings.InitialDays, "retention_days": settings.RetentionDays, "updated_at": updated,
	}
}

func (a *Adapter) applyActivityConfigure(connectionID string, payload commandPayload, now time.Time) (map[string]any, error) {
	settings := a.data.ActivitySettings[connectionID]
	if settings.InitialDays == 0 {
		settings.InitialDays = 2
	}
	if settings.RetentionDays == 0 {
		settings.RetentionDays = 7
	}
	current := settingsCurrent(settings)
	if payload.ExpectedUpdatedAt != nil {
		got := int64(0)
		if settings.UpdatedAt != nil {
			got = settings.UpdatedAt.Unix()
		}
		if *payload.ExpectedUpdatedAt != got {
			return current, adapter.Conflict(a.desc.Code, "activity settings changed", current)
		}
	}
	if payload.InitialDays < 1 || payload.InitialDays > 7 || payload.RetentionDays < 2 || payload.RetentionDays > 30 || payload.InitialDays > payload.RetentionDays {
		return current, adapter.ErrInvalidArgument
	}
	updated := now
	settings.InitialDays = payload.InitialDays
	settings.RetentionDays = payload.RetentionDays
	settings.UpdatedAt = &updated
	a.data.ActivitySettings[connectionID] = settings
	return settingsCurrent(settings), nil
}

func ruleCurrent(rule adapter.LeadStatusRule) map[string]any {
	return map[string]any{
		"rule_id": rule.ID, "revision": rule.Revision, "enabled": rule.Enabled,
		"source_pipeline_id": rule.SourcePipelineID, "source_status_id": rule.SourceStatusID,
		"target_pipeline_id": rule.TargetPipelineID, "target_status_id": rule.TargetStatusID,
	}
}

func (a *Adapter) applyLeadStatus(connectionID string, payload commandPayload, now time.Time) (map[string]any, error) {
	rules := a.data.LeadStatusRules[connectionID]
	if len(rules) == 0 {
		rules = []adapter.LeadStatusRule{{
			ID: "f1e00000-0000-4000-8000-000000000001", Revision: 1, UpdatedAt: now,
		}}
	}
	rule := rules[0]
	current := ruleCurrent(rule)
	if payload.ExpectedRevision != nil && *payload.ExpectedRevision != rule.Revision {
		return current, adapter.Conflict(a.desc.Code, "lead-status rule changed", current)
	}
	rule.SourcePipelineID = payload.SourcePipelineID
	rule.SourceStatusID = payload.SourceStatusID
	rule.TargetPipelineID = payload.TargetPipelineID
	rule.TargetStatusID = payload.TargetStatusID
	if payload.Enabled != nil {
		rule.Enabled = *payload.Enabled
	}
	rule.Revision++
	rule.UpdatedAt = now
	rules[0] = rule
	a.data.LeadStatusRules[connectionID] = rules
	return ruleCurrent(rule), nil
}

func (a *Adapter) applyActivityPanel(connectionID, command string, payload commandPayload, now time.Time) (map[string]any, error) {
	panels := a.data.ActivityPanels[connectionID]
	switch command {
	case "activity-panel-create":
		if payload.Name == "" || len(payload.EmployeeIDs) == 0 {
			return nil, adapter.ErrInvalidArgument
		}
		panel := adapter.ActivityPanel{
			ID: uuid.NewString(), Name: payload.Name, EmployeeIDs: append([]int64{}, payload.EmployeeIDs...),
			DisplayWindow: payload.DisplayWindow, Timezone: "Europe/Moscow", Enabled: true, Revision: 1, UpdatedAt: now,
		}
		if payload.Enabled != nil {
			panel.Enabled = *payload.Enabled
		}
		a.data.ActivityPanels[connectionID] = append(panels, panel)
		return map[string]any{"panel_id": panel.ID, "revision": panel.Revision, "enabled": panel.Enabled, "name": panel.Name}, nil
	case "activity-panel-patch", "activity-panel-rotate":
		for i := range panels {
			if panels[i].ID != payload.PanelID {
				continue
			}
			if command == "activity-panel-patch" && payload.Revision != panels[i].Revision {
				return map[string]any{"panel_id": panels[i].ID, "revision": panels[i].Revision}, adapter.Conflict(a.desc.Code, "activity panel changed", map[string]any{
					"panel_id": panels[i].ID, "revision": panels[i].Revision, "name": panels[i].Name, "enabled": panels[i].Enabled,
				})
			}
			if command == "activity-panel-rotate" {
				panels[i].Revision++
				panels[i].ShareURLIssued = true
				panels[i].UpdatedAt = now
				a.data.ActivityPanels[connectionID] = panels
				return map[string]any{"panel_id": panels[i].ID, "revision": panels[i].Revision}, nil
			}
			if payload.Name != "" {
				panels[i].Name = payload.Name
			}
			if payload.EmployeeIDs != nil {
				panels[i].EmployeeIDs = append([]int64{}, payload.EmployeeIDs...)
			}
			if payload.DisplayWindow.From != "" || payload.DisplayWindow.To != "" {
				panels[i].DisplayWindow = payload.DisplayWindow
			}
			if payload.Enabled != nil {
				panels[i].Enabled = *payload.Enabled
			}
			panels[i].Revision++
			panels[i].UpdatedAt = now
			a.data.ActivityPanels[connectionID] = panels
			return map[string]any{
				"panel_id": panels[i].ID, "revision": panels[i].Revision, "enabled": panels[i].Enabled, "name": panels[i].Name,
			}, nil
		}
		return nil, adapter.ErrNotFound
	default:
		return nil, adapter.ErrInvalidArgument
	}
}
func fixtureRetryAllowed(job adapter.Job) bool {
	return (job.Type == "widget.ping" || job.Type == "webhook.reconcile") && (job.Status.Canonical == "failed" || job.Status.Canonical == "dead")
}
