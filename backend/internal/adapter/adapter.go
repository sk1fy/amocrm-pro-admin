package adapter

import (
	"context"
	"time"
)

const (
	KindCoreHTTP = "core-http"
	KindFixture  = "fixture"

	ContractVersion = "v1"

	FreshnessFresh       = "fresh"
	FreshnessStale       = "stale"
	FreshnessUnavailable = "unavailable"
	FreshnessUnknown     = "unknown"

	SourceAvailable   = "available"
	SourceDegraded    = "degraded"
	SourceUnavailable = "unavailable"
	SourceUnknown     = "unknown"

	OriginReal    = "real"
	OriginFixture = "fixture"

	StateUnknown = "unknown"

	StatusPending         = "pending"
	StatusAuthorizing     = "authorizing"
	StatusActive          = "active"
	StatusReauthRequired  = "reauth_required"
	StatusDisabled        = "disabled"
	StatusUninstalled     = "uninstalled"
	StatusError           = "error"
	StatusUnregistered    = "unregistered"
	StatusQueued          = "queued"
	StatusProcessing      = "processing"
	StatusRetry           = "retry"
	StatusCompleted       = "completed"
	StatusFailed          = "failed"
	StatusDead            = "dead"
	StatusCancelled       = "cancelled"
	StatusLeaseExpired    = "lease_expired"
	StatusPendingDelivery = "pending_delivery"
	StatusDelivering      = "delivering"
	StatusAccepted        = "accepted"
	StatusExpired         = "expired"

	AuthMissing            = "missing"
	AuthReauthRequired     = "reauth_required"
	AuthRefreshing         = "refreshing"
	AuthExpiredRefreshable = "expired_refreshable"
	AuthValid              = "valid"

	GrantGranted    = "granted"
	GrantNotGranted = "not_granted"

	PilotEnabled       = "enabled"
	PilotDisabled      = "disabled"
	PilotNotConfigured = "not_configured"

	AccountNeedsAction = "needs_action"
	AccountError       = "error"
	AccountAttention   = "attention"
	AccountOK          = "ok"
	AccountInactive    = "inactive"
	AccountPartial     = "partial"

	ProblemReauthRequired     = "reauth_required"
	ProblemWebhookError       = "webhook_error"
	ProblemJobFailures        = "job_failures"
	ProblemMissingCredentials = "missing_credentials"
	ProblemDisabled           = "disabled"
	ProblemSourceUnavailable  = "source_unavailable"

	ErrorCodeUnavailable = "backend_unavailable"
	ErrorCodeTimeout     = "backend_timeout"
	ErrorCodeUnsupported = "capability_unavailable"
)

type Descriptor struct {
	Code            string
	Kind            string
	ContractVersion string
	Timeout         time.Duration
}

type Capabilities struct {
	Accounts, Connections, Integrations, Jobs, Audit bool
	Diagnostics, Commands, Settings, Stats           bool
	ActivityDeliveries                               bool
}

type Observation[T any] struct {
	Source     string    `json:"source"`
	ObservedAt time.Time `json:"observed_at"`
	Freshness  string    `json:"freshness"`
	Error      *ObsError `json:"error,omitempty"`
	Data       *T        `json:"data,omitempty"`
	Raw        string    `json:"raw,omitempty"`
}

type ObsError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type SourceStatus struct {
	Backend    string     `json:"backend"`
	Status     string     `json:"status"`
	ObservedAt *time.Time `json:"observed_at,omitempty"`
	Error      *ObsError  `json:"error,omitempty"`
}

type Page[T any] struct {
	Items      []T
	NextCursor *string
	Total      *int
}

type Actor struct {
	Value string
}

type Backend interface {
	Descriptor() Descriptor
	Capabilities() Capabilities
	Health(ctx context.Context, actor Actor) (Observation[Health], error)

	ListAccounts(ctx context.Context, actor Actor, f AccountFilter) (Observation[Page[Account]], error)
	GetAccount(ctx context.Context, actor Actor, accountID int64) (Observation[Account], error)

	ListConnections(ctx context.Context, actor Actor, f ConnectionFilter) (Observation[Page[ConnectionSummary]], error)
	GetConnection(ctx context.Context, actor Actor, id string) (Observation[ConnectionDetail], error)
	ListConnectionJobs(ctx context.Context, actor Actor, id string, f JobFilter) (Observation[Page[Job]], error)
	ListConnectionAudit(ctx context.Context, actor Actor, id string, f PageFilter) (Observation[Page[AuditEntry]], error)
	ListConnectionDeliveries(ctx context.Context, actor Actor, id string, f PageFilter) (Observation[[]Delivery], error)

	ListIntegrations(ctx context.Context, actor Actor, f PageFilter) (Observation[Page[Integration]], error)
	GetIntegration(ctx context.Context, actor Actor, id string) (Observation[Integration], error)

	ListJobs(ctx context.Context, actor Actor, f JobFilter) (Observation[Page[Job]], error)
	GetJob(ctx context.Context, actor Actor, id string) (Observation[JobDetail], error)
	JobsSummary(ctx context.Context, actor Actor) (Observation[JobsSummary], error)
}

type AccountFilter struct {
	Query         string
	IntegrationID string
	Status        string
	Limit         int
	Cursor        string
}

type ConnectionFilter struct {
	AccountID     *int64
	Domain        string
	IntegrationID string
	Status        string
	WebhookStatus string
	Limit         int
	Cursor        string
}

type JobFilter struct {
	Status string
	Type   string
	Since  *time.Time
	Limit  int
	Cursor string
}

type PageFilter struct {
	Limit  int
	Cursor string
}

type State struct {
	Canonical string
	Raw       string
}

func (s State) Present() bool {
	return s.Canonical != ""
}

func (s State) Unknown() bool {
	return s.Canonical == StateUnknown
}

type Account struct {
	AccountID      int64
	Domains        []string
	Origin         string
	LastActivityAt time.Time
	Connections    []ConnectionSummary
}

type ConnectionSummary struct {
	AuthorizationDetails *Authorization
	WebhookDetails       *Webhook
	ID                   string
	IntegrationID        string
	IntegrationCode      string
	AccountID            int64
	AccountDomain        string
	Status               State
	WebhookStatus        State
	Authorization        State
	Origin               string
	OriginRaw            string
	InstalledBy          *int64
	CreatedAt            time.Time
	UpdatedAt            time.Time
	Grants               []Grant
	Pilot                State
	RecentFailedJobs     int
}

type ConnectionDetail struct {
	Connection    ConnectionSummary
	Authorization Authorization
	Webhook       Webhook
	Grants        []Grant
	Activity      ActivityFacts
}

type Authorization struct {
	State              State
	CredentialsPresent bool
	ExpiresAt          *time.Time
	CredentialVersion  int64
	RefreshedAt        *time.Time
	KeyVersion         int
	LeaseActive        bool
	Unverified         bool
}

type Webhook struct {
	Status                State
	Events                []string
	CheckedAt             *time.Time
	LastError             *string
	ConfirmedDestinations int
}

type Grant struct {
	Service string
	State   State
}

type ActivityFacts struct {
	Pilot State
}

type Job struct {
	Cursor           string // Backend keyset position after this row; never serialized by HTTP DTOs.
	ID               string
	InstallationID   *string
	AccountID        *int64
	Type             string
	ActorType        *string
	ActorID          *string
	ResourceType     *string
	ResourceID       *string
	Status           State
	Priority         int16
	Attempts         int
	MaxAttempts      int
	RunAfter         time.Time
	LastErrorCode    *string
	LastErrorMessage *string
	CreatedAt        time.Time
	UpdatedAt        time.Time
	FinishedAt       *time.Time
}

type JobAttempt struct {
	ID           int64
	JobID        string
	Attempt      int
	WorkerID     string
	StartedAt    time.Time
	FinishedAt   *time.Time
	Outcome      State
	ErrorCode    *string
	ErrorMessage *string
	DurationMS   *int64
}

type JobDetail struct {
	Job      Job
	Attempts []JobAttempt
}

type JobsSummary struct {
	Counts map[string]int
}

type AuditEntry struct {
	Cursor           string // Backend keyset position after this row.
	ID               int64
	InstallationID   *string
	ActorType        string
	ActorID          *string
	Action           string
	ObjectType       *string
	ObjectID         *string
	Metadata         []byte
	CorrelationJobID *string
	CreatedAt        time.Time
}

type Integration struct {
	ID                    string
	Code                  string
	ClientID              string
	RedirectURI           string
	Status                State
	WebhookEvents         []string
	CreatedAt             time.Time
	UpdatedAt             time.Time
	KeyVersion            int
	Grants                []Grant
	InstallationsByStatus map[string]int
}

type Delivery struct {
	CommandID      string
	InstallationID string
	Target         string
	Action         string
	Status         State
	ErrorCode      string
	Attempts       int
	MaxAttempts    int
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type Health struct {
	Backend         string
	Revision        string
	ContractVersion string
	Capabilities    []string
	Components      any
}
