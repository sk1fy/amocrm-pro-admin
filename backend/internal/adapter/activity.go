package adapter

import (
	"context"
	"time"
)

const (
	SyncPending        = "pending"
	SyncIdle           = "idle"
	SyncRunning        = "running"
	SyncDisabled       = "disabled"
	SyncPaused         = "paused"
	SyncFailed         = "failed"
	SyncReauthRequired = "reauth_required"
	SyncNotEnabled     = "not_enabled"

	LeadRunQueued     = "queued"
	LeadRunProcessing = "processing"
	LeadRunCompleted  = "completed"
	LeadRunFailed     = "failed"
	LeadRunDead       = "dead"
)

// SettingsBackend is optional. Backends without Settings stay valid adapters.
type SettingsBackend interface {
	GetActivitySettings(context.Context, Actor, string) (Observation[ActivitySettings], error)
	GetActivitySyncStatus(context.Context, Actor, string) (Observation[ActivitySyncStatus], error)
	ListActivityPanels(context.Context, Actor, string) (Observation[[]ActivityPanel], error)
	GetActivityPanel(context.Context, Actor, string, string) (Observation[ActivityPanel], error)
	ListActivityEmployees(context.Context, Actor, string) (Observation[[]ActivityEmployee], error)
	ListLeadStatusRules(context.Context, Actor, string) (Observation[[]LeadStatusRule], error)
	ListLeadStatusRuns(context.Context, Actor, string, PageFilter) (Observation[Page[LeadStatusRun]], error)
}

type ActivitySettings struct {
	InitialDays   int
	RetentionDays int
	UpdatedAt     *time.Time
}

type ActivitySyncStatus struct {
	Enabled         *bool
	VerifiedFrom    *time.Time
	VerifiedThrough *time.Time
	LastSuccessAt   *time.Time
	LastEventAt     *time.Time
	LagSeconds      *int64
	State           State
	Verification    string
	ErrorCode       string
	ReauthRequired  bool
}

type DisplayWindow struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type ActivityPanel struct {
	ID             string
	Name           string
	EmployeeIDs    []int64
	DisplayWindow  DisplayWindow
	Timezone       string
	Enabled        bool
	Revision       int64
	UpdatedAt      time.Time
	ShareURLIssued bool
}

type ActivityEmployee struct {
	ID        int64
	Name      string
	GroupID   int64
	GroupName string
}

type LeadStatusRule struct {
	ID               string
	SourcePipelineID int64
	SourceStatusID   int64
	TargetPipelineID int64
	TargetStatusID   int64
	Enabled          bool
	Revision         int64
	UpdatedAt        time.Time
}

type LeadStatusRun struct {
	FinishedAt   *time.Time
	ID           string
	Status       State
	WorkflowType string
	SkipReason   string
	ErrorReason  string
	EffectState  string
	CreatedAt    time.Time
}

func AsSettings(backend Backend) (SettingsBackend, bool) {
	if backend == nil || !backend.Capabilities().Settings {
		return nil, false
	}
	settings, ok := backend.(SettingsBackend)
	return settings, ok
}
