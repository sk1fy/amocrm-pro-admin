package core

import (
	"encoding/json"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

type listEnvelope struct {
	Source     string          `json:"source"`
	ObservedAt time.Time       `json:"observed_at"`
	Items      json.RawMessage `json:"items"`
	NextCursor *string         `json:"next_cursor"`
	Total      *int            `json:"total"`
}

type errorEnvelope struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type healthResponse struct {
	Source          string          `json:"source"`
	ObservedAt      time.Time       `json:"observed_at"`
	Backend         string          `json:"backend"`
	Revision        string          `json:"revision"`
	ContractVersion string          `json:"contract_version"`
	Capabilities    []string        `json:"capabilities"`
	Components      json.RawMessage `json:"components"`
}

type accountListItem struct {
	AccountID      int64                 `json:"account_id"`
	Domains        []string              `json:"domains"`
	LastActivityAt time.Time             `json:"last_activity_at"`
	Origin         string                `json:"origin"`
	Installations  []accountInstallation `json:"installations"`
}

type accountInstallation struct {
	AuthorizationCheck *adapter.Verification `json:"authorization_check"`
	Grants             []grant               `json:"grants"`
	ID                 string                `json:"id"`
	IntegrationID      string                `json:"integration_id"`
	IntegrationCode    string                `json:"integration_code"`
	Status             string                `json:"status"`
	WebhookStatus      string                `json:"webhook_status"`
	Authorization      string                `json:"authorization_state"`
	RecentFailedJobs   int                   `json:"recent_failed_jobs"`
}

type accountResponse struct {
	Source        string             `json:"source"`
	ObservedAt    time.Time          `json:"observed_at"`
	AccountID     int64              `json:"account_id"`
	Domains       []string           `json:"domains"`
	Origin        string             `json:"origin"`
	Installations []installationCard `json:"installations"`
}

type installationSummary struct {
	AuthorizationCheck *adapter.Verification `json:"authorization_check"`
	RecentFailedJobs   int                   `json:"recent_failed_jobs"`
	ID                 string                `json:"id"`
	IntegrationID      string                `json:"integration_id"`
	IntegrationCode    string                `json:"integration_code"`
	AccountID          int64                 `json:"account_id"`
	AccountDomain      string                `json:"account_domain"`
	Status             string                `json:"status"`
	InstalledBy        *int64                `json:"installed_by"`
	Origin             string                `json:"origin"`
	CreatedAt          time.Time             `json:"created_at"`
	UpdatedAt          time.Time             `json:"updated_at"`
	WebhookStatus      string                `json:"webhook_status"`
}

type installationCard struct {
	Installation  installationSummary `json:"installation"`
	Authorization authorization       `json:"authorization"`
	Webhook       webhookInfo         `json:"webhook"`
	Grants        []grant             `json:"grants"`
	Activity      activityInfo        `json:"activity"`
}

type installationResponse struct {
	Source        string              `json:"source"`
	ObservedAt    time.Time           `json:"observed_at"`
	Installation  installationSummary `json:"installation"`
	Authorization authorization       `json:"authorization"`
	Webhook       webhookInfo         `json:"webhook"`
	Grants        []grant             `json:"grants"`
	Activity      activityInfo        `json:"activity"`
}

type authorization struct {
	State              string     `json:"state"`
	CredentialsPresent bool       `json:"credentials_present"`
	ExpiresAt          *time.Time `json:"expires_at"`
	CredentialVersion  int64      `json:"credential_version"`
	RefreshedAt        *time.Time `json:"refreshed_at"`
	KeyVersion         int        `json:"key_version"`
	LeaseActive        bool       `json:"lease_active"`
	Unverified         bool       `json:"unverified"`
}

type webhookInfo struct {
	Status                string     `json:"status"`
	Events                []string   `json:"events"`
	CheckedAt             *time.Time `json:"checked_at"`
	LastError             *string    `json:"last_error"`
	ConfirmedDestinations int        `json:"confirmed_destinations"`
}

type grant struct {
	Service string `json:"service"`
	Enabled bool   `json:"enabled"`
}

type activityInfo struct {
	Pilot string `json:"pilot"`
}

type job struct {
	RetryAllowed     *bool      `json:"retry_allowed"`
	ID               string     `json:"id"`
	InstallationID   *string    `json:"installation_id"`
	AccountID        *int64     `json:"account_id"`
	Type             string     `json:"type"`
	ActorType        *string    `json:"actor_type"`
	ActorID          *string    `json:"actor_id"`
	ResourceType     *string    `json:"resource_type"`
	ResourceID       *string    `json:"resource_id"`
	Status           string     `json:"status"`
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

type jobAttempt struct {
	ID           int64      `json:"id"`
	JobID        string     `json:"job_id"`
	Attempt      int        `json:"attempt"`
	WorkerID     string     `json:"worker_id"`
	StartedAt    time.Time  `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at"`
	Outcome      *string    `json:"outcome"`
	ErrorCode    *string    `json:"error_code"`
	ErrorMessage *string    `json:"error_message"`
	DurationMS   *int64     `json:"duration_ms"`
}

type jobResponse struct {
	Source     string       `json:"source"`
	ObservedAt time.Time    `json:"observed_at"`
	Job        job          `json:"job"`
	Attempts   []jobAttempt `json:"attempts"`
}

type jobsSummaryResponse struct {
	Source     string         `json:"source"`
	ObservedAt time.Time      `json:"observed_at"`
	Counts     map[string]int `json:"counts"`
}

type auditEntry struct {
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

type integration struct {
	ID                    string         `json:"id"`
	Code                  string         `json:"code"`
	ClientID              string         `json:"client_id"`
	RedirectURI           string         `json:"redirect_uri"`
	Status                string         `json:"status"`
	WebhookEvents         []string       `json:"webhook_events"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
	KeyVersion            int            `json:"key_version"`
	Grants                []grant        `json:"grants"`
	InstallationsByStatus map[string]int `json:"installations_by_status"`
}

type integrationResponse struct {
	Source      string      `json:"source"`
	ObservedAt  time.Time   `json:"observed_at"`
	Integration integration `json:"integration"`
}

type deliveriesResponse struct {
	Source     string     `json:"source"`
	ObservedAt time.Time  `json:"observed_at"`
	Items      []delivery `json:"items"`
}

type delivery struct {
	CommandID      string    `json:"command_id"`
	InstallationID string    `json:"installation_id"`
	Target         string    `json:"target"`
	Action         string    `json:"action"`
	Status         string    `json:"status"`
	ErrorCode      string    `json:"error_code"`
	Attempts       int       `json:"attempts"`
	MaxAttempts    int       `json:"max_attempts"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type activitySettingsResponse struct {
	Source        string    `json:"source"`
	ObservedAt    time.Time `json:"observed_at"`
	InitialDays   int       `json:"initial_days"`
	RetentionDays int       `json:"retention_days"`
	UpdatedAt     int64     `json:"updated_at"`
}

type activityStatusResponse struct {
	Enabled         *bool      `json:"enabled"`
	VerifiedFrom    *time.Time `json:"verified_from"`
	VerifiedThrough *time.Time `json:"verified_through"`
	LastSuccessAt   *time.Time `json:"last_success_at"`
	LastEventAt     *time.Time `json:"last_event_at"`
	LagSeconds      *int64     `json:"lag_seconds"`
	Source          string     `json:"source"`
	ObservedAt      time.Time  `json:"observed_at"`
	State           string     `json:"state"`
	Verification    string     `json:"verification"`
	ErrorCode       string     `json:"error_code"`
	ReauthRequired  bool       `json:"reauth_required"`
}

type activityPanel struct {
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

type activityPanelsResponse struct {
	Source     string          `json:"source"`
	ObservedAt time.Time       `json:"observed_at"`
	Items      []activityPanel `json:"items"`
}

type activityPanelResponse struct {
	activityPanel
	Source     string         `json:"source"`
	ObservedAt time.Time      `json:"observed_at"`
	Panel      *activityPanel `json:"panel"`
}

type activityEmployee struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	GroupID   int64  `json:"group_id"`
	GroupName string `json:"group_name"`
}

type activityEmployeesResponse struct {
	Source     string             `json:"source"`
	ObservedAt time.Time          `json:"observed_at"`
	Items      []activityEmployee `json:"items"`
	Users      []activityEmployee `json:"users"`
}

type leadStatusRule struct {
	ID               string    `json:"id"`
	SourcePipelineID int64     `json:"source_pipeline_id"`
	SourceStatusID   int64     `json:"source_status_id"`
	TargetPipelineID int64     `json:"target_pipeline_id"`
	TargetStatusID   int64     `json:"target_status_id"`
	Enabled          bool      `json:"enabled"`
	Revision         int64     `json:"revision"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type leadStatusRulesResponse struct {
	Source     string           `json:"source"`
	ObservedAt time.Time        `json:"observed_at"`
	Items      []leadStatusRule `json:"items"`
}

type leadStatusRun struct {
	FinishedAt   *time.Time `json:"finished_at"`
	EffectError  *string    `json:"effect_error"`
	ID           string     `json:"id"`
	Status       string     `json:"status"`
	WorkflowType string     `json:"workflow_type"`
	SkipReason   string     `json:"skip_reason"`
	ErrorReason  string     `json:"error_reason"`
	EffectState  string     `json:"effect_state"`
	CreatedAt    time.Time  `json:"created_at"`
}

type statsResponse struct {
	Verification      *adapter.VerificationCounts `json:"verification"`
	Connected         *int                        `json:"connected"`
	Disconnected      *int                        `json:"disconnected"`
	ActiveAccounts    *int                        `json:"active_accounts"`
	LastUseAt         *time.Time                  `json:"last_use_at"`
	JobErrors         *int                        `json:"job_errors"`
	LatencyP50Ms      *int64                      `json:"latency_p50_ms"`
	AuthProblems      *int                        `json:"auth_problems"`
	SyncProblems      *int                        `json:"sync_problems"`
	AuthProblemsCount *int64                      `json:"auth_problems_count"`
	SyncProblemsCount *int64                      `json:"sync_problems_count"`
	Source            string                      `json:"source"`
	ObservedAt        time.Time                   `json:"observed_at"`
	Period            string                      `json:"period"`
	PeriodStart       time.Time                   `json:"period_start"`
	PeriodEnd         time.Time                   `json:"period_end"`
	From              time.Time                   `json:"from"`
	To                time.Time                   `json:"to"`
	Connections       []statsConnection           `json:"connections"`
	Queues            []adapter.StatsQueueCount   `json:"queues"`
	PeriodEvents      struct {
		Connected    *int64 `json:"connected"`
		Disconnected *int64 `json:"disconnected"`
	} `json:"period_events"`
	Latency struct {
		P50MS *float64 `json:"p50_ms"`
	} `json:"latency"`
}

type statsConnection struct {
	Product         string `json:"product"`
	IntegrationCode string `json:"integration_code"`
	Status          string `json:"status"`
	Count           int    `json:"count"`
}

type statsAccount struct {
	AccountID       int64  `json:"account_id"`
	Domain          string `json:"domain"`
	InstallationID  string `json:"installation_id"`
	IntegrationCode string `json:"integration_code"`
	Reason          string `json:"reason"`
}
