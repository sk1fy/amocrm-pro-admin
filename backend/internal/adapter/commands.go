package adapter

import (
	"context"
	"encoding/json"
	"time"
)

// CommandBackend is optional: read-only backends remain valid adapters.
type CommandBackend interface {
	ExecuteCommand(context.Context, Actor, string, CommandRequest) (CommandResult, error)
	GetCommand(context.Context, Actor, string) (CommandResult, error)
}

type CommandRequest struct {
	TargetType string          `json:"target_type"`
	TargetID   string          `json:"target_id"`
	Command    string          `json:"command"`
	Payload    json.RawMessage `json:"payload"`
}

type CommandResult struct {
	ID         string         `json:"id"`
	State      string         `json:"state"`
	Outcome    string         `json:"outcome,omitempty"`
	Result     map[string]any `json:"result"`
	Error      *ObsError      `json:"error,omitempty"`
	ObservedAt time.Time      `json:"observed_at"`
	JobID      string         `json:"job_id,omitempty"`
}
