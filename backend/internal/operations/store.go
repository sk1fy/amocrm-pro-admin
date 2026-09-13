package operations

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
)

var ErrConflict = errors.New("operation conflicts with current state or request")
var ErrNotFound = errors.New("operation not found")
var ErrInvalid = errors.New("invalid operation request")
var ErrForbidden = errors.New("insufficient permissions")

const operationColumns = `id,employee_id,actor_email,request_id,changed_fields,backend,target_type,target_id,command,idempotency_key,request_hash,state,outcome,result,error,lease_until,created_at,updated_at,finished_at,observed_at`

type Operation struct {
	RequestID  uuid.UUID         `json:"-"`
	Changed    []string          `json:"-"`
	ID         uuid.UUID         `json:"id"`
	EmployeeID uuid.UUID         `json:"employee_id"`
	ActorEmail string            `json:"-"`
	Backend    string            `json:"backend"`
	TargetType string            `json:"target_type"`
	TargetID   string            `json:"target_id"`
	Command    string            `json:"command"`
	Key        string            `json:"-"`
	Hash       []byte            `json:"-"`
	State      string            `json:"state"`
	Outcome    string            `json:"outcome,omitempty"`
	Result     json.RawMessage   `json:"result"`
	Error      *adapter.ObsError `json:"error,omitempty"`
	LeaseUntil time.Time         `json:"-"`
	CreatedAt  time.Time         `json:"created_at"`
	UpdatedAt  time.Time         `json:"updated_at"`
	FinishedAt *time.Time        `json:"finished_at"`
	ObservedAt *time.Time        `json:"observed_at"`
}

type Store struct {
	pool    *pgxpool.Pool
	audit   *audit.Store
	timeout time.Duration
}

func NewStore(pool *pgxpool.Pool, timeout time.Duration, a *audit.Store) *Store {
	return &Store{pool: pool, timeout: timeout, audit: a}
}
func scan(row pgx.Row) (Operation, error) {
	var o Operation
	var rawError []byte
	err := row.Scan(&o.ID, &o.EmployeeID, &o.ActorEmail, &o.RequestID, &o.Changed, &o.Backend, &o.TargetType, &o.TargetID, &o.Command, &o.Key, &o.Hash, &o.State, &o.Outcome, &o.Result, &rawError, &o.LeaseUntil, &o.CreatedAt, &o.UpdatedAt, &o.FinishedAt, &o.ObservedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return o, ErrNotFound
	}
	if err != nil {
		return o, err
	}
	if len(rawError) > 0 && string(rawError) != "null" {
		if err := json.Unmarshal(rawError, &o.Error); err != nil {
			return o, err
		}
	}
	return o, nil
}

func (s *Store) Admit(ctx context.Context, o Operation) (Operation, bool, error) {
	if o.RequestID == uuid.Nil {
		o.RequestID = uuid.New()
	}
	if o.Changed == nil {
		o.Changed = []string{}
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return o, false, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	got, err := scan(tx.QueryRow(ctx, `INSERT INTO operations(id,employee_id,actor_email,request_id,changed_fields,backend,target_type,target_id,command,idempotency_key,request_hash,state,lease_until)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'running',$12)
 ON CONFLICT(backend,target_type,target_id,command,idempotency_key) DO NOTHING RETURNING `+operationColumns, o.ID, o.EmployeeID, o.ActorEmail, o.RequestID, o.Changed, o.Backend, o.TargetType, o.TargetID, o.Command, o.Key, o.Hash, o.LeaseUntil))
	if errors.Is(err, ErrNotFound) {
		got, err = scan(tx.QueryRow(ctx, `SELECT `+operationColumns+` FROM operations WHERE backend=$1 AND target_type=$2 AND target_id=$3 AND command=$4 AND idempotency_key=$5`, o.Backend, o.TargetType, o.TargetID, o.Command, o.Key))
		if err != nil {
			return o, false, err
		}
		if !bytes.Equal(got.Hash, o.Hash) {
			return o, false, ErrConflict
		}
		return got, false, tx.Commit(ctx)
	}
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return o, false, ErrConflict
		}
		return o, false, err
	}
	if err = s.audit.RecordTx(ctx, tx, audit.Event{RequestID: o.RequestID, EmployeeID: &o.EmployeeID, ActorEmail: o.ActorEmail, Action: "operation.accepted", ObjectType: o.TargetType, ObjectRef: objectRef(o), Metadata: map[string]any{"operation_id": o.ID.String(), "command": o.Command, "changed": o.Changed}}); err != nil {
		return o, false, err
	}
	return got, true, tx.Commit(ctx)
}
func objectRef(o Operation) string {
	if o.TargetType == "installation" {
		return "connection:" + o.Backend + ":" + o.TargetID
	}
	return o.TargetType + ":" + o.Backend + ":" + o.TargetID
}
func (s *Store) Get(ctx context.Context, id uuid.UUID) (Operation, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	return scan(s.pool.QueryRow(ctx, `SELECT `+operationColumns+` FROM operations WHERE id=$1`, id))
}

const terminalStatePredicate = `state IN ('succeeded','failed','partial','unknown_outcome')`

// PruneTerminalBefore deletes operations in terminal states last updated before
// the cutoff and returns the number of deleted rows. Non-terminal operations
// (accepted, pending, running) are never deleted, regardless of age.
func (s *Store) PruneTerminalBefore(ctx context.Context, before time.Time) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tag, err := s.pool.Exec(ctx, `DELETE FROM operations WHERE updated_at < $1 AND `+terminalStatePredicate, before.UTC())
	if err != nil {
		return 0, fmt.Errorf("prune terminal operations: %w", err)
	}
	return tag.RowsAffected(), nil
}

// CountTerminalBefore reports how many operations PruneTerminalBefore would
// delete without touching them (dry run).
func (s *Store) CountTerminalBefore(ctx context.Context, before time.Time) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	var count int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM operations WHERE updated_at < $1 AND `+terminalStatePredicate, before.UTC()).Scan(&count); err != nil {
		return 0, fmt.Errorf("count terminal operations for prune: %w", err)
	}
	return count, nil
}

func (s *Store) Finish(ctx context.Context, previous Operation, result adapter.CommandResult) (Operation, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return previous, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	current, err := scan(tx.QueryRow(ctx, `SELECT `+operationColumns+` FROM operations WHERE id=$1 FOR UPDATE`, previous.ID))
	if err != nil {
		return previous, err
	}
	// An older concurrent poll must never overwrite a terminal, confirmed result.
	if terminal(current.State) && current.State != "unknown_outcome" {
		return current, nil
	}
	raw, err := json.Marshal(safeResult(result))
	if err != nil {
		return current, err
	}
	errorJSON, err := json.Marshal(result.Error)
	if err != nil {
		return current, err
	}
	state := result.State
	switch state {
	case "accepted", "pending", "running", "succeeded", "failed", "partial", "unknown_outcome":
	default:
		state = "unknown_outcome"
	}
	var finished any
	if terminal(state) {
		finished = time.Now().UTC()
	}
	observed := result.ObservedAt
	if observed.IsZero() {
		observed = time.Now().UTC()
	}
	got, err := scan(tx.QueryRow(ctx, `UPDATE operations SET state=$2,outcome=$3,result=$4,error=$5,finished_at=$6,observed_at=$7 WHERE id=$1 RETURNING `+operationColumns, current.ID, state, result.Outcome, raw, errorJSON, finished, observed))
	if err != nil {
		return current, err
	}
	if current.State != state || !bytes.Equal(current.Result, raw) {
		outcome := audit.OutcomeOK
		if state == "failed" || state == "unknown_outcome" || state == "partial" {
			outcome = audit.OutcomeFailed
		}
		if err = s.audit.RecordTx(ctx, tx, audit.Event{RequestID: current.RequestID, EmployeeID: &current.EmployeeID, ActorEmail: current.ActorEmail, Action: "operation." + state, ObjectType: current.TargetType, ObjectRef: objectRef(current), Outcome: outcome, Metadata: map[string]any{"operation_id": current.ID.String(), "command": current.Command, "state": state, "outcome": result.Outcome, "changed": current.Changed}}); err != nil {
			return current, err
		}
	}
	return got, tx.Commit(ctx)
}
func copySafeResultValue(key string, value any) (any, bool) {
	switch v := value.(type) {
	case nil:
		return nil, true
	case string:
		if key == "webhook_error" {
			v = adapter.RedactError(v)
		}
		return v, true
	case bool, float64, int, int64, json.Number:
		return v, true
	case []any:
		if key != "employee_ids" {
			return nil, false
		}
		out := make([]any, 0, len(v))
		for _, item := range v {
			switch item.(type) {
			case float64, int, int64, json.Number, string:
				out = append(out, item)
			}
		}
		return out, true
	default:
		return nil, false
	}
}

func terminal(state string) bool {
	return state == "succeeded" || state == "failed" || state == "partial" || state == "unknown_outcome"
}

func safeResult(result adapter.CommandResult) map[string]any {
	out := map[string]any{}
	for _, key := range []string{
		"integration_id", "installation_id", "code", "status", "action", "webhook_error", "job_id",
		"classification", "verification", "observed_at", "retry_after", "oauth_start_url", "enabled",
		"service", "pilot", "command_id", "initial_days", "retention_days", "updated_at", "kind",
		"from", "to", "operation_id", "delivery_state", "state", "revision", "panel_id", "name",
		"employee_ids", "lag_seconds", "expected_revision", "rule_id", "source_pipeline_id",
		"source_status_id", "target_pipeline_id", "target_status_id",
	} {
		value, ok := result.Result[key]
		if !ok {
			continue
		}
		if copied, ok := copySafeResultValue(key, value); ok {
			out[key] = copied
		}
	}
	if result.JobID != "" {
		out["job_id"] = result.JobID
	}
	if _, ok := out["classification"]; !ok {
		switch result.Outcome {
		case "verified_ok", "auth_error", "network_error", "rate_limited", "internal_error":
			out["classification"] = result.Outcome
		}
	}
	return out
}

type ListFilter struct {
	Backend, TargetType, TargetID, Command, State, Key, Cursor string
	Limit                                                      int
	Active                                                     bool
}

func (s *Store) List(ctx context.Context, f ListFilter) ([]Operation, *string, error) {
	args := []any{}
	where := []string{"true"}
	for _, filter := range []struct{ column, value string }{{"backend", f.Backend}, {"target_type", f.TargetType}, {"target_id", f.TargetID}, {"command", f.Command}, {"state", f.State}, {"idempotency_key", f.Key}} {
		if filter.value != "" {
			args = append(args, filter.value)
			where = append(where, fmt.Sprintf("%s=$%d", filter.column, len(args)))
		}
	}
	if f.Active {
		where = append(where, `state IN ('running','accepted','pending','unknown_outcome')`)
	}
	if f.Cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(f.Cursor)
		if err != nil {
			return nil, nil, ErrInvalid
		}
		parts := strings.Split(string(raw), "|")
		if len(parts) != 2 {
			return nil, nil, ErrInvalid
		}
		at, err := time.Parse(time.RFC3339Nano, parts[0])
		if err != nil {
			return nil, nil, ErrInvalid
		}
		id, err := uuid.Parse(parts[1])
		if err != nil {
			return nil, nil, ErrInvalid
		}
		args = append(args, at, id)
		where = append(where, fmt.Sprintf("(created_at,id)<($%d,$%d)", len(args)-1, len(args)))
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}
	args = append(args, limit+1)
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	rows, err := s.pool.Query(ctx, `SELECT `+operationColumns+` FROM operations WHERE `+strings.Join(where, " AND ")+fmt.Sprintf(` ORDER BY created_at DESC,id DESC LIMIT $%d`, len(args)), args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	items := []Operation{}
	for rows.Next() {
		o, err := scan(rows)
		if err != nil {
			return nil, nil, err
		}
		items = append(items, o)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	var next *string
	if len(items) > limit {
		last := items[limit-1]
		cursor := base64.RawURLEncoding.EncodeToString([]byte(last.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + last.ID.String()))
		next = &cursor
		items = items[:limit]
	}
	return items, next, nil
}
