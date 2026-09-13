package httpapi

import (
	"encoding/json"
	"strconv"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/accounts"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/operations"
)

type sourcedListResponse struct {
	Items      any                    `json:"items"`
	NextCursor *string                `json:"next_cursor"`
	Total      *int                   `json:"total"`
	Sources    []adapter.SourceStatus `json:"sources"`
}

type observationDTO struct {
	Source     string            `json:"source"`
	ObservedAt time.Time         `json:"observed_at"`
	Freshness  string            `json:"freshness"`
	Error      *adapter.ObsError `json:"error,omitempty"`
	Data       any               `json:"data,omitempty"`
	Raw        string            `json:"raw,omitempty"`
}

type accountListItemDTO struct {
	AccountID      string                 `json:"account_id"`
	Domains        []string               `json:"domains"`
	State          string                 `json:"state"`
	Problems       []string               `json:"problems"`
	Origin         string                 `json:"origin"`
	LastActivityAt *time.Time             `json:"last_activity_at"`
	Connections    []accountConnectionDTO `json:"connections"`
}

type accountConnectionDTO struct {
	Backend         string `json:"backend"`
	ConnectionID    string `json:"connection_id"`
	IntegrationID   string `json:"integration_id,omitempty"`
	IntegrationCode string `json:"integration_code"`
	State           string `json:"state"`
	Raw             string `json:"raw,omitempty"`
}

type accountCardDTO struct {
	AccountID      string                 `json:"account_id"`
	Domains        []string               `json:"domains"`
	State          string                 `json:"state"`
	Problems       []string               `json:"problems"`
	Origin         string                 `json:"origin"`
	LastActivityAt *time.Time             `json:"last_activity_at"`
	Connections    []observationDTO       `json:"connections"`
	Sources        []adapter.SourceStatus `json:"sources"`
}

type connectionCardDTO struct {
	AuthorizationCheck observationDTO `json:"authorization_check"`
	Backend            string         `json:"backend"`
	Connection         observationDTO `json:"connection"`
	Authorization      observationDTO `json:"authorization"`
	Webhook            observationDTO `json:"webhook"`
	Grants             observationDTO `json:"grants"`
	Activity           observationDTO `json:"activity"`
	ActivitySync       observationDTO `json:"activity_sync"`
	RecentJobs         observationDTO `json:"recent_jobs"`
	RecentAudit        observationDTO `json:"recent_audit"`
}

type connectionDTO struct {
	ID              string    `json:"id"`
	IntegrationID   string    `json:"integration_id"`
	IntegrationCode string    `json:"integration_code"`
	AccountID       string    `json:"account_id"`
	AccountDomain   string    `json:"account_domain"`
	State           string    `json:"state"`
	Raw             string    `json:"raw,omitempty"`
	Origin          string    `json:"origin"`
	InstalledBy     *int64    `json:"installed_by"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type authorizationDTO struct {
	State              string     `json:"state"`
	Raw                string     `json:"raw,omitempty"`
	CredentialsPresent bool       `json:"credentials_present"`
	ExpiresAt          *time.Time `json:"expires_at"`
	CredentialVersion  int64      `json:"credential_version,omitempty"`
	RefreshedAt        *time.Time `json:"refreshed_at"`
	KeyVersion         int        `json:"key_version,omitempty"`
	LeaseActive        bool       `json:"lease_active"`
	Unverified         bool       `json:"unverified"`
}

type webhookDTO struct {
	Status                string     `json:"status"`
	Raw                   string     `json:"raw,omitempty"`
	Events                []string   `json:"events"`
	CheckedAt             *time.Time `json:"checked_at"`
	LastError             *string    `json:"last_error"`
	ConfirmedDestinations int        `json:"confirmed_destinations"`
}

type grantDTO struct {
	Service string `json:"service"`
	State   string `json:"state"`
	Raw     string `json:"raw,omitempty"`
}

type activityDTO struct {
	Pilot    string `json:"pilot"`
	PilotRaw string `json:"pilot_raw,omitempty"`
}

type jobDTO struct {
	RetryAllowed     bool       `json:"retry_allowed"`
	RetryReason      string     `json:"retry_reason,omitempty"`
	ID               string     `json:"id"`
	InstallationID   *string    `json:"installation_id"`
	AccountID        *string    `json:"account_id,omitempty"`
	Type             string     `json:"type"`
	ActorType        *string    `json:"actor_type"`
	ActorID          *string    `json:"actor_id"`
	ResourceType     *string    `json:"resource_type"`
	ResourceID       *string    `json:"resource_id"`
	Status           string     `json:"status"`
	Raw              string     `json:"raw,omitempty"`
	Priority         int16      `json:"priority"`
	Attempts         int        `json:"attempts"`
	MaxAttempts      int        `json:"max_attempts"`
	RunAfter         time.Time  `json:"run_after"`
	LastErrorCode    *string    `json:"last_error_code"`
	LastErrorMessage *string    `json:"last_error_message"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	FinishedAt       *time.Time `json:"finished_at"`
}

type jobAttemptDTO struct {
	ID           int64      `json:"id"`
	JobID        string     `json:"job_id"`
	Attempt      int        `json:"attempt"`
	WorkerID     string     `json:"worker_id"`
	StartedAt    time.Time  `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at"`
	Outcome      string     `json:"outcome"`
	Raw          string     `json:"raw,omitempty"`
	ErrorCode    *string    `json:"error_code"`
	ErrorMessage *string    `json:"error_message"`
	DurationMS   *int64     `json:"duration_ms"`
}

type jobDetailDTO struct {
	Job      jobDTO          `json:"job"`
	Attempts []jobAttemptDTO `json:"attempts"`
}

type integrationDTO struct {
	Backend               string         `json:"backend"`
	ID                    string         `json:"id"`
	Code                  string         `json:"code"`
	ClientID              string         `json:"client_id"`
	RedirectURI           string         `json:"redirect_uri"`
	State                 string         `json:"state"`
	Raw                   string         `json:"raw,omitempty"`
	WebhookEvents         []string       `json:"webhook_events"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
	KeyVersion            int            `json:"key_version"`
	Grants                []grantDTO     `json:"grants"`
	InstallationsByStatus map[string]int `json:"installations_by_status"`
}

type auditEntryDTO struct {
	ID               int64           `json:"id"`
	InstallationID   *string         `json:"installation_id"`
	ActorType        string          `json:"actor_type"`
	ActorID          *string         `json:"actor_id"`
	Action           string          `json:"action"`
	ObjectType       *string         `json:"object_type"`
	ObjectID         *string         `json:"object_id"`
	Metadata         json.RawMessage `json:"metadata"`
	CorrelationJobID *string         `json:"correlation_job_id"`
	CreatedAt        time.Time       `json:"created_at"`
}

type historyItemDTO struct {
	Source       string          `json:"source"`
	Backend      string          `json:"backend,omitempty"`
	OccurredAt   time.Time       `json:"occurred_at"`
	Action       string          `json:"action"`
	ActorType    *string         `json:"actor_type,omitempty"`
	ActorID      *string         `json:"actor_id,omitempty"`
	ActorEmail   *string         `json:"actor_email,omitempty"`
	ObjectType   *string         `json:"object_type,omitempty"`
	ObjectID     *string         `json:"object_id,omitempty"`
	ObjectRef    *string         `json:"object_ref,omitempty"`
	ConnectionID *string         `json:"connection_id,omitempty"`
	Outcome      *string         `json:"outcome,omitempty"`
	Metadata     json.RawMessage `json:"metadata"`
}

type deliveryDTO struct {
	RetryAllowed   bool      `json:"retry_allowed"`
	RetryReason    string    `json:"retry_reason,omitempty"`
	CommandID      string    `json:"command_id"`
	InstallationID string    `json:"installation_id"`
	Target         string    `json:"target"`
	Action         string    `json:"action"`
	Status         string    `json:"status"`
	Raw            string    `json:"raw,omitempty"`
	ErrorCode      string    `json:"error_code,omitempty"`
	Attempts       int       `json:"attempts"`
	MaxAttempts    int       `json:"max_attempts"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type catalogResponse struct {
	Backends []catalogBackendDTO `json:"backends"`
	Products []catalogProductDTO `json:"products"`
}

type catalogBackendDTO struct {
	Code        string              `json:"code"`
	Kind        string              `json:"kind"`
	DisplayName string              `json:"display_name"`
	Products    []catalogProductDTO `json:"products"`
}

type catalogProductDTO struct {
	Code        string `json:"code"`
	DisplayName string `json:"display_name"`
}

type activitySettingsDTO struct {
	UpdatedAt     *time.Time `json:"updated_at"`
	InitialDays   int        `json:"initial_days"`
	RetentionDays int        `json:"retention_days"`
}

type activitySyncDTO struct {
	Enabled         *bool      `json:"enabled"`
	VerifiedFrom    *time.Time `json:"verified_from"`
	VerifiedThrough *time.Time `json:"verified_through"`
	LastSuccessAt   *time.Time `json:"last_success_at"`
	LastEventAt     *time.Time `json:"last_event_at"`
	LagSeconds      *int64     `json:"lag_seconds"`
	State           string     `json:"state"`
	Raw             string     `json:"raw,omitempty"`
	Verification    string     `json:"verification,omitempty"`
	ErrorCode       string     `json:"error_code,omitempty"`
	ReauthRequired  bool       `json:"reauth_required"`
}

type activityPanelDTO struct {
	ID             string                `json:"id"`
	Name           string                `json:"name"`
	EmployeeIDs    []int64               `json:"employee_ids"`
	DisplayWindow  adapter.DisplayWindow `json:"display_window"`
	Timezone       string                `json:"timezone"`
	Enabled        bool                  `json:"enabled"`
	Revision       int64                 `json:"revision"`
	UpdatedAt      time.Time             `json:"updated_at"`
	ShareURLIssued bool                  `json:"share_url_issued"`
}

type activityEmployeeDTO struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	GroupID   int64  `json:"group_id"`
	GroupName string `json:"group_name"`
}

type leadStatusRuleDTO struct {
	ID               string    `json:"id"`
	SourcePipelineID int64     `json:"source_pipeline_id"`
	SourceStatusID   int64     `json:"source_status_id"`
	TargetPipelineID int64     `json:"target_pipeline_id"`
	TargetStatusID   int64     `json:"target_status_id"`
	Enabled          bool      `json:"enabled"`
	Revision         int64     `json:"revision"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type leadStatusRunDTO struct {
	FinishedAt   *time.Time `json:"finished_at"`
	ID           string     `json:"id"`
	Status       string     `json:"status"`
	Raw          string     `json:"raw,omitempty"`
	WorkflowType string     `json:"workflow_type"`
	SkipReason   string     `json:"skip_reason,omitempty"`
	ErrorReason  string     `json:"error_reason,omitempty"`
	EffectState  string     `json:"effect_state,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

type statsSnapshotDTO struct {
	Connected      *int                           `json:"connected"`
	Disconnected   *int                           `json:"disconnected"`
	ActiveAccounts *int                           `json:"active_accounts"`
	LastUseAt      *time.Time                     `json:"last_use_at"`
	JobErrors      *int                           `json:"job_errors"`
	LatencyP50Ms   *int64                         `json:"latency_p50_ms"`
	AuthProblems   *int                           `json:"auth_problems"`
	SyncProblems   *int                           `json:"sync_problems"`
	Period         string                         `json:"period"`
	PeriodStart    time.Time                      `json:"period_start"`
	PeriodEnd      time.Time                      `json:"period_end"`
	Connections    []adapter.StatsConnectionCount `json:"connections"`
	Queues         []adapter.StatsQueueCount      `json:"queues"`
}

type statsAccountDTO struct {
	AccountID       string `json:"account_id"`
	Domain          string `json:"domain"`
	Backend         string `json:"backend"`
	InstallationID  string `json:"installation_id"`
	IntegrationCode string `json:"integration_code"`
	Reason          string `json:"reason"`
}

type observabilityDTO struct {
	GrafanaBaseURL string `json:"grafana_base_url,omitempty"`
	LokiBaseURL    string `json:"loki_base_url,omitempty"`
}

func toAccountListItem(item accounts.Aggregated) accountListItemDTO {
	connections := make([]accountConnectionDTO, 0, len(item.Connections))
	for _, conn := range item.Connections {
		connections = append(connections, accountConnectionDTO{
			Backend: conn.Backend, ConnectionID: conn.ConnectionID,
			IntegrationID: conn.IntegrationID, IntegrationCode: conn.IntegrationCode,
			State: conn.State.Canonical, Raw: conn.State.Raw,
		})
	}
	return accountListItemDTO{
		AccountID:      formatAccountID(item.AccountID),
		Domains:        item.Domains,
		State:          item.State,
		Problems:       item.Problems,
		Origin:         item.Origin,
		LastActivityAt: timeOrNil(item.LastActivityAt),
		Connections:    connections,
	}
}

func toAccountCard(card accounts.AccountCard) accountCardDTO {
	connections := make([]observationDTO, 0, len(card.Connections))
	for _, conn := range card.Connections {
		observedAt := conn.ObservedAt
		freshness := conn.Freshness
		if observedAt.IsZero() || freshness == "" {
			observedAt = time.Now().UTC()
			freshness = adapter.FreshnessUnknown
		}
		connections = append(connections, observationDTO{
			Source: conn.Backend, ObservedAt: observedAt, Freshness: freshness,
			Data: map[string]any{
				"backend":          conn.Backend,
				"connection_id":    conn.ConnectionID,
				"integration_code": conn.IntegrationCode,
				"state":            conn.State.Canonical,
				"raw":              omitEmpty(conn.State.Raw),
				"account_domain":   conn.AccountDomain,
				"origin":           conn.Origin,
				"authorization":    accountAuthorization(conn),
				"webhook":          accountWebhook(conn),
				"grants":           toGrantDTOs(conn.Grants),
				"activity":         activityDTO{Pilot: conn.Pilot.Canonical, PilotRaw: conn.Pilot.Raw},
			},
		})
	}
	sources := card.Sources
	if sources == nil {
		sources = []adapter.SourceStatus{}
	}
	return accountCardDTO{
		AccountID:      formatAccountID(card.AccountID),
		Domains:        card.Domains,
		State:          card.State,
		Problems:       card.Problems,
		Origin:         card.Origin,
		LastActivityAt: timeOrNil(card.LastActivityAt),
		Connections:    connections,
		Sources:        sources,
	}
}

func toConnectionDTO(item adapter.ConnectionSummary) connectionDTO {
	return connectionDTO{
		ID: item.ID, IntegrationID: item.IntegrationID, IntegrationCode: item.IntegrationCode,
		AccountID: formatAccountID(item.AccountID), AccountDomain: item.AccountDomain,
		State: item.Status.Canonical, Raw: item.Status.Raw, Origin: item.Origin,
		InstalledBy: item.InstalledBy, CreatedAt: item.CreatedAt.UTC(), UpdatedAt: item.UpdatedAt.UTC(),
	}
}

func toAuthorizationDTO(item adapter.Authorization) authorizationDTO {
	return authorizationDTO{
		State: item.State.Canonical, Raw: item.State.Raw, CredentialsPresent: item.CredentialsPresent,
		ExpiresAt: item.ExpiresAt, CredentialVersion: item.CredentialVersion, RefreshedAt: item.RefreshedAt,
		KeyVersion: item.KeyVersion, LeaseActive: item.LeaseActive, Unverified: item.Unverified,
	}
}

func toWebhookDTO(item adapter.Webhook) webhookDTO {
	events := item.Events
	if events == nil {
		events = []string{}
	}
	return webhookDTO{
		Status: item.Status.Canonical, Raw: item.Status.Raw, Events: events,
		CheckedAt: item.CheckedAt, LastError: item.LastError, ConfirmedDestinations: item.ConfirmedDestinations,
	}
}

func toGrantDTOs(items []adapter.Grant) []grantDTO {
	out := make([]grantDTO, 0, len(items))
	for _, item := range items {
		out = append(out, grantDTO{Service: item.Service, State: item.State.Canonical, Raw: item.State.Raw})
	}
	return out
}

func toJobDTO(item adapter.Job) jobDTO {
	return jobDTO{
		RetryAllowed: operations.RetryJobAllowed(item), RetryReason: retryReason(operations.RetryJobAllowed(item)),
		ID: item.ID, InstallationID: item.InstallationID, AccountID: formatAccountIDPtr(item.AccountID),
		Type:      item.Type,
		ActorType: item.ActorType, ActorID: item.ActorID, ResourceType: item.ResourceType, ResourceID: item.ResourceID,
		Status: item.Status.Canonical, Raw: item.Status.Raw, Priority: item.Priority,
		Attempts: item.Attempts, MaxAttempts: item.MaxAttempts, RunAfter: item.RunAfter.UTC(),
		LastErrorCode: item.LastErrorCode, LastErrorMessage: item.LastErrorMessage,
		CreatedAt: item.CreatedAt.UTC(), UpdatedAt: item.UpdatedAt.UTC(), FinishedAt: item.FinishedAt,
	}
}

func toJobAttemptDTO(item adapter.JobAttempt) jobAttemptDTO {
	return jobAttemptDTO{
		ID: item.ID, JobID: item.JobID, Attempt: item.Attempt, WorkerID: item.WorkerID,
		StartedAt: item.StartedAt.UTC(), FinishedAt: item.FinishedAt,
		Outcome: item.Outcome.Canonical, Raw: item.Outcome.Raw,
		ErrorCode: item.ErrorCode, ErrorMessage: item.ErrorMessage, DurationMS: item.DurationMS,
	}
}

func toIntegrationDTO(backend string, item adapter.Integration) integrationDTO {
	counts := item.InstallationsByStatus
	if counts == nil {
		counts = map[string]int{}
	}
	return integrationDTO{
		Backend: backend, ID: item.ID, Code: item.Code, ClientID: item.ClientID, RedirectURI: item.RedirectURI,
		State: item.Status.Canonical, Raw: item.Status.Raw, WebhookEvents: nonNilStrings(item.WebhookEvents),
		CreatedAt: item.CreatedAt.UTC(), UpdatedAt: item.UpdatedAt.UTC(), KeyVersion: item.KeyVersion,
		Grants: toGrantDTOs(item.Grants), InstallationsByStatus: counts,
	}
}

func toAuditDTOFromAdapter(item adapter.AuditEntry) auditEntryDTO {
	metadata := json.RawMessage(item.Metadata)
	if len(metadata) == 0 {
		metadata = json.RawMessage(`{}`)
	}
	return auditEntryDTO{
		ID: item.ID, InstallationID: item.InstallationID, ActorType: item.ActorType, ActorID: item.ActorID,
		Action: item.Action, ObjectType: item.ObjectType, ObjectID: item.ObjectID, Metadata: metadata,
		CorrelationJobID: item.CorrelationJobID, CreatedAt: item.CreatedAt.UTC(),
	}
}

func toHistoryDTO(item accounts.HistoryItem) historyItemDTO {
	metadata := json.RawMessage(item.Metadata)
	if len(metadata) == 0 {
		metadata = json.RawMessage(`{}`)
	}
	return historyItemDTO{
		Source: item.Source, Backend: item.Backend, OccurredAt: item.OccurredAt.UTC(), Action: item.Action,
		ActorType: item.ActorType, ActorID: item.ActorID, ActorEmail: item.ActorEmail,
		ObjectType: item.ObjectType, ObjectID: item.ObjectID, ObjectRef: item.ObjectRef,
		ConnectionID: item.ConnectionID, Outcome: item.Outcome, Metadata: metadata,
	}
}

func toDeliveryDTO(item adapter.Delivery) deliveryDTO {
	return deliveryDTO{
		RetryAllowed: operations.RetryDeliveryAllowed(item), RetryReason: retryReason(operations.RetryDeliveryAllowed(item)),
		CommandID: item.CommandID, InstallationID: item.InstallationID, Target: item.Target, Action: item.Action,
		Status: item.Status.Canonical, Raw: item.Status.Raw, ErrorCode: item.ErrorCode,
		Attempts: item.Attempts, MaxAttempts: item.MaxAttempts,
		CreatedAt: item.CreatedAt.UTC(), UpdatedAt: item.UpdatedAt.UTC(),
	}
}

func observationFrom[T any](obs adapter.Observation[T], data any) observationDTO {
	return observationDTO{
		Source: obs.Source, ObservedAt: obs.ObservedAt.UTC(), Freshness: obs.Freshness,
		Error: obs.Error, Data: data, Raw: obs.Raw,
	}
}

func unavailableObservation(source string, err error) observationDTO {
	obs := adapter.UnavailableObs[struct{}](source, time.Now().UTC(), err)
	return observationDTO{Source: obs.Source, ObservedAt: obs.ObservedAt, Freshness: obs.Freshness, Error: obs.Error}
}

func formatAccountID(id int64) string {
	return strconv.FormatInt(id, 10)
}

func formatAccountIDPtr(id *int64) *string {
	if id == nil {
		return nil
	}
	formatted := formatAccountID(*id)
	return &formatted
}

func timeOrNil(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	utc := value.UTC()
	return &utc
}

func omitEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nonNilStrings(items []string) []string {
	if items == nil {
		return []string{}
	}
	return items
}

func accountAuthorization(conn accounts.Connection) any {
	if conn.AuthorizationDetails != nil {
		return toAuthorizationDTO(*conn.AuthorizationDetails)
	}
	// A summary without credential facts cannot assert their absence or validity.
	return map[string]any{"state": conn.Authorization.Canonical, "raw": omitEmpty(conn.Authorization.Raw), "unverified": true}
}
func accountWebhook(conn accounts.Connection) any {
	if conn.WebhookDetails != nil {
		return toWebhookDTO(*conn.WebhookDetails)
	}
	return map[string]any{"status": conn.Webhook.Canonical, "raw": omitEmpty(conn.Webhook.Raw)}
}

func retryReason(allowed bool) string {
	if allowed {
		return ""
	}
	return "Повтор недоступен для этого типа, состояния или срока хранения"
}

func toActivitySettingsDTO(item adapter.ActivitySettings) activitySettingsDTO {
	return activitySettingsDTO{InitialDays: item.InitialDays, RetentionDays: item.RetentionDays, UpdatedAt: item.UpdatedAt}
}

func toActivitySyncDTO(item adapter.ActivitySyncStatus) activitySyncDTO {
	return activitySyncDTO{
		State: item.State.Canonical, Raw: item.State.Raw, Verification: item.Verification, Enabled: item.Enabled,
		VerifiedFrom: item.VerifiedFrom, VerifiedThrough: item.VerifiedThrough, LastSuccessAt: item.LastSuccessAt,
		LastEventAt: item.LastEventAt, LagSeconds: item.LagSeconds, ErrorCode: item.ErrorCode, ReauthRequired: item.ReauthRequired,
	}
}

func toActivityPanelDTO(item adapter.ActivityPanel) activityPanelDTO {
	ids := item.EmployeeIDs
	if ids == nil {
		ids = []int64{}
	}
	return activityPanelDTO{
		ID: item.ID, Name: item.Name, EmployeeIDs: ids, DisplayWindow: item.DisplayWindow, Timezone: item.Timezone,
		Enabled: item.Enabled, Revision: item.Revision, UpdatedAt: item.UpdatedAt.UTC(), ShareURLIssued: item.ShareURLIssued,
	}
}

func toActivityEmployeeDTO(item adapter.ActivityEmployee) activityEmployeeDTO {
	return activityEmployeeDTO{ID: item.ID, Name: item.Name, GroupID: item.GroupID, GroupName: item.GroupName}
}

func toLeadStatusRuleDTO(item adapter.LeadStatusRule) leadStatusRuleDTO {
	return leadStatusRuleDTO{
		ID: item.ID, SourcePipelineID: item.SourcePipelineID, SourceStatusID: item.SourceStatusID,
		TargetPipelineID: item.TargetPipelineID, TargetStatusID: item.TargetStatusID,
		Enabled: item.Enabled, Revision: item.Revision, UpdatedAt: item.UpdatedAt.UTC(),
	}
}

func toLeadStatusRunDTO(item adapter.LeadStatusRun) leadStatusRunDTO {
	return leadStatusRunDTO{
		ID: item.ID, Status: item.Status.Canonical, Raw: item.Status.Raw, WorkflowType: item.WorkflowType,
		SkipReason: item.SkipReason, ErrorReason: item.ErrorReason, EffectState: item.EffectState,
		CreatedAt: item.CreatedAt.UTC(), FinishedAt: item.FinishedAt,
	}
}

func toStatsSnapshotDTO(item adapter.StatsSnapshot) statsSnapshotDTO {
	connections := item.Connections
	if connections == nil {
		connections = []adapter.StatsConnectionCount{}
	}
	queues := item.Queues
	if queues == nil {
		queues = []adapter.StatsQueueCount{}
	}
	return statsSnapshotDTO{
		Period: item.Period, PeriodStart: item.PeriodStart.UTC(), PeriodEnd: item.PeriodEnd.UTC(),
		Connections: connections, Connected: item.Connected, Disconnected: item.Disconnected,
		ActiveAccounts: item.ActiveAccounts, LastUseAt: item.LastUseAt, JobErrors: item.JobErrors,
		LatencyP50Ms: item.LatencyP50Ms, Queues: queues, AuthProblems: item.AuthProblems, SyncProblems: item.SyncProblems,
	}
}

func toStatsAccountDTO(backend string, item adapter.StatsAccount) statsAccountDTO {
	return statsAccountDTO{
		AccountID: formatAccountID(item.AccountID), Domain: item.Domain, Backend: backend,
		InstallationID: item.InstallationID, IntegrationCode: item.IntegrationCode, Reason: item.Reason,
	}
}
