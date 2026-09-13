package core

import (
	"encoding/json"
	"time"
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
	Grants           []grant `json:"grants"`
	ID               string  `json:"id"`
	IntegrationID    string  `json:"integration_id"`
	IntegrationCode  string  `json:"integration_code"`
	Status           string  `json:"status"`
	WebhookStatus    string  `json:"webhook_status"`
	Authorization    string  `json:"authorization_state"`
	RecentFailedJobs int     `json:"recent_failed_jobs"`
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
	RecentFailedJobs int       `json:"recent_failed_jobs"`
	ID               string    `json:"id"`
	IntegrationID    string    `json:"integration_id"`
	IntegrationCode  string    `json:"integration_code"`
	AccountID        int64     `json:"account_id"`
	AccountDomain    string    `json:"account_domain"`
	Status           string    `json:"status"`
	InstalledBy      *int64    `json:"installed_by"`
	Origin           string    `json:"origin"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
	WebhookStatus    string    `json:"webhook_status"`
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
