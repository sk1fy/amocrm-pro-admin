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
	hash   [32]byte
	result adapter.CommandResult
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
	var payload struct {
		Code           string   `json:"code"`
		ClientID       string   `json:"client_id"`
		Secret         string   `json:"client_secret"`
		RedirectURI    string   `json:"redirect_uri"`
		WebhookEvents  []string `json:"webhook_events"`
		Services       []string `json:"services"`
		Service        string   `json:"service"`
		Enabled        bool     `json:"enabled"`
		InstallationID string   `json:"installation_id"`
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
					foundGrant := false
					for j := range item.Grants {
						if item.Grants[j].Service == payload.Service {
							item.Grants[j].State = adapter.MapGrant(payload.Enabled)
							foundGrant = true
						}
					}
					if !foundGrant {
						item.Grants = append(item.Grants, adapter.Grant{Service: payload.Service, State: adapter.MapGrant(payload.Enabled)})
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
	a.commands[key] = commandReceipt{hash: hash, result: result}
	return result, nil
}
func fixtureRetryAllowed(job adapter.Job) bool {
	return (job.Type == "widget.ping" || job.Type == "webhook.reconcile") && (job.Status.Canonical == "failed" || job.Status.Canonical == "dead")
}
