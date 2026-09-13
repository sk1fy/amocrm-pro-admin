package operations

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/catalog"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
)

type EmployeeReader interface {
	Get(context.Context, uuid.UUID) (rbac.Employee, error)
}
type Service struct {
	store     *Store
	registry  *catalog.Registry
	employees EmployeeReader
}

func New(store *Store, registry *catalog.Registry, employees EmployeeReader) *Service {
	return &Service{store: store, registry: registry, employees: employees}
}

func Permission(target, command string) string {
	switch target {
	case "installation":
		switch command {
		case "enable":
			return rbac.ConnectionsEnable
		case "disable":
			return rbac.ConnectionsDisable
		case "revoke":
			return rbac.ConnectionsRevoke
		case "uninstall":
			return rbac.ConnectionsUninstall
		case "reconcile":
			return rbac.WebhooksReconcile
		case "check":
			return rbac.ConnectionsCheck
		case "pilot-enable", "pilot-disable":
			return rbac.ActivityPilot
		}
	case "integration":
		switch command {
		case "create", "update", "set-service":
			return rbac.IntegrationsWrite
		case "rotate-secret":
			return rbac.IntegrationsRotateSecret
		case "enable":
			return rbac.IntegrationsEnable
		case "disable":
			return rbac.IntegrationsDisable
		}
	case "job", "delivery":
		if command == "retry" {
			return rbac.OperationsRetry
		}
	}
	return ""
}
func (s *Service) authorize(ctx context.Context, id uuid.UUID, permission string) (rbac.Employee, error) {
	employee, err := s.employees.Get(ctx, id)
	if err != nil || employee.Status != auth.StatusActive || permission == "" || !rbac.Allows(employee.Role, permission) {
		return employee, ErrForbidden
	}
	return employee, nil
}

type Submit struct {
	EmployeeID   uuid.UUID
	Backend, Key string
	Request      adapter.CommandRequest
}

func (s *Service) Execute(ctx context.Context, input Submit) (Operation, error) {
	permission := Permission(input.Request.TargetType, input.Request.Command)
	if permission == "" {
		return Operation{}, ErrInvalid
	}
	employee, err := s.authorize(ctx, input.EmployeeID, permission)
	if err != nil {
		return Operation{}, err
	}
	if strings.TrimSpace(input.Key) != input.Key || len(input.Key) < 1 || len(input.Key) > 128 || strings.ContainsAny(input.Key, "\r\n\t") {
		return Operation{}, ErrInvalid
	}
	backend, ok := s.registry.Adapter(input.Backend)
	if !ok {
		return Operation{}, ErrNotFound
	}
	commander, ok := backend.(adapter.CommandBackend)
	if !ok || !backend.Capabilities().Commands {
		return Operation{}, adapter.ErrUnsupported
	}
	var payload map[string]json.RawMessage
	if json.Unmarshal(input.Request.Payload, &payload) != nil || payload == nil {
		return Operation{}, ErrInvalid
	}
	input.Request.Payload, err = json.Marshal(payload)
	if err != nil {
		return Operation{}, ErrInvalid
	}
	encoded, err := json.Marshal(input.Request)
	if err != nil {
		return Operation{}, ErrInvalid
	}
	hash := sha256.Sum256(encoded)
	timeout := backend.Descriptor().Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	// Core receipt ID is this durable ID. No request payload or secret is persisted.
	operation := Operation{RequestID: httpx.RequestIDFromContext(ctx), Changed: changedFields(payload), ID: uuid.New(), EmployeeID: employee.ID, ActorEmail: employee.Email, Backend: input.Backend, TargetType: input.Request.TargetType, TargetID: input.Request.TargetID, Command: input.Request.Command, Key: input.Key, Hash: hash[:], LeaseUntil: time.Now().UTC().Add(2*timeout + 10*time.Second)}
	operation, created, err := s.store.Admit(ctx, operation)
	if err != nil {
		return operation, err
	}
	if !created {
		return s.Get(ctx, operation.ID)
	}
	// A disconnected browser cannot discard a result already admitted to the DB.
	execution, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*timeout)
	defer cancel()
	_, err = s.authorize(execution, input.EmployeeID, permission)
	actor := adapter.EmployeeActor(input.EmployeeID)
	if err == nil {
		err = preflight(execution, backend, actor, input.Request)
	}
	if err == nil {
		_, err = s.authorize(execution, input.EmployeeID, permission)
	}
	if err != nil {
		return s.persist(operation, adapter.CommandResult{State: "failed", Error: commandError(err)})
	}
	result, err := commander.ExecuteCommand(execution, actor, operation.ID.String(), input.Request)
	if err != nil {
		state := "unknown_outcome"
		if errors.Is(err, adapter.ErrRejected) || errors.Is(err, adapter.ErrInvalidArgument) || errors.Is(err, adapter.ErrNotFound) || errors.Is(err, adapter.ErrConflict) || errors.Is(err, adapter.ErrUnsupported) {
			state = "failed"
		}
		result = adapter.CommandResult{State: state, Error: commandError(err)}
	}
	if result.ID != "" && result.ID != operation.ID.String() {
		result = adapter.CommandResult{State: "unknown_outcome", Error: commandError(adapter.ErrUnavailable)}
	}
	return s.persist(operation, result)
}
func (s *Service) persist(operation Operation, result adapter.CommandResult) (Operation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return s.store.Finish(ctx, operation, result)
}
func commandError(err error) *adapter.ObsError {
	code := "backend_unavailable"
	switch {
	case errors.Is(err, adapter.ErrRejected):
		code = "backend_rejected"
	case errors.Is(err, ErrForbidden):
		code = "forbidden"
	case errors.Is(err, ErrConflict) || errors.Is(err, adapter.ErrConflict):
		code = "conflict"
	case errors.Is(err, adapter.ErrInvalidArgument) || errors.Is(err, ErrInvalid):
		code = "invalid_argument"
	case errors.Is(err, adapter.ErrNotFound):
		code = "not_found"
	case errors.Is(err, adapter.ErrTimeout):
		code = "backend_timeout"
	case errors.Is(err, adapter.ErrUnsupported):
		code = "capability_unavailable"
	}
	message := adapter.SafeMessage(err)
	if code == "forbidden" {
		message = "insufficient permissions"
	}
	return &adapter.ObsError{Code: code, Message: message}
}

func preflight(ctx context.Context, b adapter.Backend, actor adapter.Actor, c adapter.CommandRequest) error {
	switch c.TargetType {
	case "installation":
		obs, err := b.GetConnection(ctx, actor, c.TargetID)
		if err != nil {
			return err
		}
		if obs.Data == nil {
			return adapter.ErrUnavailable
		}
		state := obs.Data.Connection.Status.Canonical
		if c.Command == "enable" && state != adapter.StatusDisabled {
			return adapter.ErrConflict
		}
		if c.Command == "revoke" && (state == adapter.StatusDisabled || state == adapter.StatusUninstalled) {
			return adapter.ErrConflict
		}
	case "integration":
		if c.Command != "create" {
			obs, err := b.GetIntegration(ctx, actor, c.TargetID)
			if err != nil {
				return err
			}
			if obs.Data == nil {
				return adapter.ErrUnavailable
			}
		}
	case "job":
		obs, err := b.GetJob(ctx, actor, c.TargetID)
		if err != nil {
			return err
		}
		if obs.Data == nil {
			return adapter.ErrUnavailable
		}
		if !RetryJobAllowed(obs.Data.Job) {
			return adapter.ErrConflict
		}
	case "delivery":
		var payload struct {
			InstallationID string `json:"installation_id"`
		}
		if json.Unmarshal(c.Payload, &payload) != nil || payload.InstallationID == "" {
			return ErrInvalid
		}
		// Inspect membership in Core at command admission; the unbounded receipt list
		// is deliberately not scanned here. The parent connection must exist.
		if _, err := b.GetConnection(ctx, actor, payload.InstallationID); err != nil {
			return err
		}
	}
	return nil
}
func RetryJobAllowed(job adapter.Job) bool {
	return (job.RetryAllowed == nil || *job.RetryAllowed) && (job.Type == "webhook.reconcile" || job.Type == "widget.ping") && (job.Status.Canonical == adapter.StatusFailed || job.Status.Canonical == adapter.StatusDead)
}
func RetryDeliveryAllowed(d adapter.Delivery) bool {
	return d.Status.Canonical == adapter.StatusFailed && !d.CreatedAt.IsZero() && time.Since(d.CreatedAt) < 7*24*time.Hour
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Operation, error) {
	operation, err := s.store.Get(ctx, id)
	if err != nil {
		return operation, err
	}
	if terminal(operation.State) && operation.State != "unknown_outcome" {
		return operation, nil
	}
	if (operation.State == "running" || operation.State == "accepted") && time.Now().Before(operation.LeaseUntil) {
		return operation, nil
	}
	backend, ok := s.registry.Adapter(operation.Backend)
	if !ok {
		return operation, nil
	}
	commander, ok := backend.(adapter.CommandBackend)
	if !ok {
		return operation, nil
	}
	result, err := commander.GetCommand(ctx, adapter.EmployeeActor(operation.EmployeeID), operation.ID.String())
	if err != nil {
		// The receipt can arrive later. Never redispatch a lost body (notably secrets).
		if operation.State == "running" || operation.State == "accepted" || errors.Is(err, adapter.ErrNotFound) {
			return s.persist(operation, adapter.CommandResult{State: "unknown_outcome", Error: commandError(err)})
		}
		return operation, nil
	}
	if result.ID != "" && result.ID != operation.ID.String() {
		result = adapter.CommandResult{State: "unknown_outcome", Error: commandError(adapter.ErrUnavailable)}
	}
	return s.persist(operation, result)
}
func (s *Service) List(ctx context.Context, f ListFilter) ([]Operation, *string, error) {
	return s.store.List(ctx, f)
}
func (s *Service) Reconcile(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	cursor := ""
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pass, cancel := context.WithTimeout(ctx, 8*time.Second)
			items, next, err := s.store.List(pass, ListFilter{Active: true, Limit: 25, Cursor: cursor})
			if err == nil {
				complete := true
				for _, o := range items {
					if pass.Err() != nil {
						complete = false
						break
					}
					_, _ = s.Get(pass, o.ID)
					cursor = base64.RawURLEncoding.EncodeToString([]byte(o.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + o.ID.String()))
				}
				if complete && next == nil {
					cursor = ""
				}
			}
			cancel()
		}
	}
}
func (s *Service) LatestCheck(ctx context.Context, backend, id string) adapter.Observation[map[string]any] {
	items, _, err := s.store.List(ctx, ListFilter{Backend: backend, TargetType: "installation", TargetID: id, Command: "check", Limit: 1})
	if err != nil {
		return adapter.UnavailableObs[map[string]any](backend, time.Now(), err)
	}
	if len(items) == 0 {
		return adapter.UnknownObs[map[string]any](backend, time.Now(), "not_checked", "Connection has not been checked")
	}
	operation, err := s.Get(ctx, items[0].ID)
	if err != nil {
		return adapter.UnavailableObs[map[string]any](backend, time.Now(), err)
	}
	var data map[string]any
	if json.Unmarshal(operation.Result, &data) != nil || operation.State != "succeeded" || data["classification"] == nil {
		return adapter.UnknownObs[map[string]any](backend, operation.UpdatedAt, "check_pending", "Check has no confirmed result")
	}
	observed := operation.UpdatedAt
	if value, ok := data["observed_at"].(string); ok {
		if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
			observed = parsed
		}
	}
	obs := adapter.Fresh(backend, observed, data)
	if time.Since(observed) > 15*time.Minute {
		obs.Freshness = adapter.FreshnessStale
	}
	return obs
}

func changedFields(payload map[string]json.RawMessage) []string {
	fields := []string{}
	for _, key := range []string{"code", "client_id", "client_secret", "redirect_uri", "webhook_events", "services", "service", "enabled", "installation_id"} {
		if _, ok := payload[key]; ok {
			fields = append(fields, key)
		}
	}
	sort.Strings(fields)
	return fields
}
