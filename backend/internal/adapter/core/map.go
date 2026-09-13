package core

import (
	"encoding/base64"
	"strconv"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

func mapAccountListItem(item accountListItem) adapter.Account {
	connections := make([]adapter.ConnectionSummary, 0, len(item.Installations))
	for _, inst := range item.Installations {
		summary := adapter.ConnectionSummary{
			ID:               inst.ID,
			IntegrationID:    inst.IntegrationID,
			IntegrationCode:  inst.IntegrationCode,
			AccountID:        item.AccountID,
			Status:           adapter.MapConnectionStatus(inst.Status),
			Origin:           mapOriginValue(item.Origin),
			RecentFailedJobs: inst.RecentFailedJobs,
			Grants:           mapGrants(inst.Grants),
		}
		if inst.Authorization != "" {
			summary.Authorization = adapter.MapAuthState(inst.Authorization)
		}
		if inst.WebhookStatus != "" {
			summary.WebhookStatus = adapter.MapWebhookStatus(inst.WebhookStatus)
		}
		connections = append(connections, summary)
	}
	return adapter.Account{
		AccountID:      item.AccountID,
		Domains:        nonNil(item.Domains),
		Origin:         mapOriginValue(item.Origin),
		LastActivityAt: item.LastActivityAt.UTC(),
		Connections:    connections,
	}
}

func mapAccount(resp accountResponse) adapter.Account {
	connections := make([]adapter.ConnectionSummary, 0, len(resp.Installations))
	for _, card := range resp.Installations {
		connections = append(connections, mapCardSummary(card))
	}
	last := time.Time{}
	for _, conn := range connections {
		if conn.UpdatedAt.After(last) {
			last = conn.UpdatedAt
		}
	}
	return adapter.Account{
		AccountID:      resp.AccountID,
		Domains:        nonNil(resp.Domains),
		Origin:         mapOriginValue(resp.Origin),
		LastActivityAt: last,
		Connections:    connections,
	}
}

func mapCardSummary(card installationCard) adapter.ConnectionSummary {
	summary := mapInstallation(card.Installation)
	summary.Authorization = adapter.MapAuthState(card.Authorization.State)
	authorization := mapAuthorization(card.Authorization)
	summary.AuthorizationDetails = &authorization
	webhook := mapWebhook(card.Webhook)
	summary.WebhookDetails = &webhook
	summary.WebhookStatus = adapter.MapWebhookStatus(card.Webhook.Status)
	summary.Grants = mapGrants(card.Grants)
	summary.Pilot = adapter.MapPilot(card.Activity.Pilot)
	return summary
}

func mapInstallation(item installationSummary) adapter.ConnectionSummary {
	origin := adapter.MapOrigin(item.Origin)
	return adapter.ConnectionSummary{
		RecentFailedJobs: item.RecentFailedJobs,
		ID:               item.ID,
		IntegrationID:    item.IntegrationID,
		IntegrationCode:  item.IntegrationCode,
		AccountID:        item.AccountID,
		AccountDomain:    item.AccountDomain,
		Status:           adapter.MapConnectionStatus(item.Status),
		WebhookStatus:    optionalWebhook(item.WebhookStatus),
		Origin:           origin.Canonical,
		OriginRaw:        origin.Raw,
		InstalledBy:      item.InstalledBy,
		CreatedAt:        item.CreatedAt.UTC(),
		UpdatedAt:        item.UpdatedAt.UTC(),
	}
}

func mapConnectionDetail(resp installationResponse) adapter.ConnectionDetail {
	card := installationCard{
		Installation:  resp.Installation,
		Authorization: resp.Authorization,
		Webhook:       resp.Webhook,
		Grants:        resp.Grants,
		Activity:      resp.Activity,
	}
	return adapter.ConnectionDetail{
		Connection:    mapCardSummary(card),
		Authorization: mapAuthorization(resp.Authorization),
		Webhook:       mapWebhook(resp.Webhook),
		Grants:        mapGrants(resp.Grants),
		Activity:      adapter.ActivityFacts{Pilot: adapter.MapPilot(resp.Activity.Pilot)},
	}
}

func mapAuthorization(item authorization) adapter.Authorization {
	return adapter.Authorization{
		State:              adapter.MapAuthState(item.State),
		CredentialsPresent: item.CredentialsPresent,
		ExpiresAt:          utcPtr(item.ExpiresAt),
		CredentialVersion:  item.CredentialVersion,
		RefreshedAt:        utcPtr(item.RefreshedAt),
		KeyVersion:         item.KeyVersion,
		LeaseActive:        item.LeaseActive,
		Unverified:         item.Unverified,
	}
}

func mapWebhook(item webhookInfo) adapter.Webhook {
	var lastError *string
	if item.LastError != nil {
		redacted := adapter.RedactError(*item.LastError)
		lastError = &redacted
	}
	return adapter.Webhook{
		Status:                adapter.MapWebhookStatus(item.Status),
		Events:                nonNil(item.Events),
		CheckedAt:             utcPtr(item.CheckedAt),
		LastError:             lastError,
		ConfirmedDestinations: item.ConfirmedDestinations,
	}
}

func mapGrants(items []grant) []adapter.Grant {
	out := make([]adapter.Grant, 0, len(items))
	for _, item := range items {
		out = append(out, adapter.Grant{Service: item.Service, State: adapter.MapGrant(item.Enabled)})
	}
	return out
}

func mapJob(item job) adapter.Job {
	var message *string
	if item.LastErrorMessage != nil {
		redacted := adapter.RedactError(*item.LastErrorMessage)
		message = &redacted
	}
	return adapter.Job{
		RetryAllowed:     item.RetryAllowed,
		Cursor:           rowCursor(item.UpdatedAt, item.ID),
		ID:               item.ID,
		InstallationID:   item.InstallationID,
		AccountID:        item.AccountID,
		Type:             item.Type,
		ActorType:        item.ActorType,
		ActorID:          item.ActorID,
		ResourceType:     item.ResourceType,
		ResourceID:       item.ResourceID,
		Status:           adapter.MapJobStatus(item.Status),
		Priority:         item.Priority,
		Attempts:         item.Attempts,
		MaxAttempts:      item.MaxAttempts,
		RunAfter:         item.RunAfter.UTC(),
		LastErrorCode:    item.LastErrorCode,
		LastErrorMessage: message,
		CreatedAt:        item.CreatedAt.UTC(),
		UpdatedAt:        item.UpdatedAt.UTC(),
		FinishedAt:       utcPtr(item.FinishedAt),
	}
}

func mapJobAttempt(item jobAttempt) adapter.JobAttempt {
	outcome := adapter.State{}
	if item.Outcome != nil {
		outcome = adapter.MapJobOutcome(*item.Outcome)
	}
	var message *string
	if item.ErrorMessage != nil {
		redacted := adapter.RedactError(*item.ErrorMessage)
		message = &redacted
	}
	return adapter.JobAttempt{
		ID:           item.ID,
		JobID:        item.JobID,
		Attempt:      item.Attempt,
		WorkerID:     item.WorkerID,
		StartedAt:    item.StartedAt.UTC(),
		FinishedAt:   utcPtr(item.FinishedAt),
		Outcome:      outcome,
		ErrorCode:    item.ErrorCode,
		ErrorMessage: message,
		DurationMS:   item.DurationMS,
	}
}

func mapAudit(item auditEntry) adapter.AuditEntry {
	return adapter.AuditEntry{
		Cursor:           rowCursor(item.CreatedAt, strconv.FormatInt(item.ID, 10)),
		ID:               item.ID,
		InstallationID:   item.InstallationID,
		ActorType:        item.ActorType,
		ActorID:          item.ActorID,
		Action:           item.Action,
		ObjectType:       item.ObjectType,
		ObjectID:         item.ObjectID,
		Metadata:         item.Metadata,
		CorrelationJobID: item.CorrelationJobID,
		CreatedAt:        item.CreatedAt.UTC(),
	}
}

func mapIntegration(item integration) adapter.Integration {
	return adapter.Integration{
		ID:                    item.ID,
		Code:                  item.Code,
		ClientID:              item.ClientID,
		RedirectURI:           item.RedirectURI,
		Status:                adapter.MapIntegrationStatus(item.Status),
		WebhookEvents:         nonNil(item.WebhookEvents),
		CreatedAt:             item.CreatedAt.UTC(),
		UpdatedAt:             item.UpdatedAt.UTC(),
		KeyVersion:            item.KeyVersion,
		Grants:                mapGrants(item.Grants),
		InstallationsByStatus: item.InstallationsByStatus,
	}
}

func mapDelivery(item delivery) adapter.Delivery {
	return adapter.Delivery{
		CommandID:      item.CommandID,
		InstallationID: item.InstallationID,
		Target:         item.Target,
		Action:         item.Action,
		Status:         adapter.MapOutboxStatus(item.Status),
		ErrorCode:      item.ErrorCode,
		Attempts:       item.Attempts,
		MaxAttempts:    item.MaxAttempts,
		CreatedAt:      item.CreatedAt.UTC(),
		UpdatedAt:      item.UpdatedAt.UTC(),
	}
}

func mapOriginValue(raw string) string {
	mapped := adapter.MapOrigin(raw)
	if mapped.Unknown() || mapped.Canonical == "" {
		if raw == adapter.OriginFixture {
			return adapter.OriginFixture
		}
		return adapter.OriginReal
	}
	return mapped.Canonical
}

func optionalWebhook(raw string) adapter.State {
	if raw == "" {
		return adapter.State{}
	}
	return adapter.MapWebhookStatus(raw)
}

func utcPtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	utc := value.UTC()
	return &utc
}

func nonNil[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}

// rowCursor is Core admin v1's timestamp/id keyset encoding. Keeping it in
// the adapter lets aggregation advance a partially consumed backend page.
func rowCursor(at time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(at.UTC().Format(time.RFC3339Nano) + "|" + id))
}
