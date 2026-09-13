package audit

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	ActionLogin           = "auth.login"
	ActionLoginFailed     = "auth.login_failed"
	ActionLogout          = "auth.logout"
	ActionEmployeeCreate  = "employee.create"
	ActionEmployeeUpdate  = "employee.update"
	ActionEmployeeDisable = "employee.disable"
	ActionSessionsRevoke  = "employee.sessions.revoke"
	ActionSessionRevoke   = "session.revoke"

	OutcomeOK     = "ok"
	OutcomeDenied = "denied"
	OutcomeFailed = "failed"

	defaultLimit = 25
	maxLimit     = 100
)

var (
	ErrForbiddenMetadata = errors.New("audit metadata contains a forbidden key")
	ErrInvalidCursor     = errors.New("invalid cursor")
)

var forbiddenKeyParts = []string{"secret", "token", "password", "ciphertext", "key_hash"}

type Store struct {
	pool    *pgxpool.Pool
	timeout time.Duration
}

type Event struct {
	EmployeeID *uuid.UUID
	ActorEmail string
	Action     string
	ObjectType string
	ObjectRef  string
	Outcome    string
	RequestID  uuid.UUID
	IP         string
	Metadata   map[string]any
}

type Entry struct {
	ID         int64
	EmployeeID *uuid.UUID
	ActorEmail *string
	Action     string
	ObjectType *string
	ObjectRef  *string
	Outcome    string
	RequestID  *uuid.UUID
	IP         *string
	Metadata   json.RawMessage
	CreatedAt  time.Time
}

type ListFilter struct {
	EmployeeID *uuid.UUID
	Action     string
	ObjectRefs []string
	Cursor     string
	Limit      int
}

func NewStore(pool *pgxpool.Pool, timeout time.Duration) *Store {
	return &Store{pool: pool, timeout: timeout}
}

func ValidateMetadata(metadata map[string]any) error {
	if metadata == nil {
		return nil
	}
	return walkMetadata(metadata)
}

type executor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (s *Store) Record(ctx context.Context, event Event) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	return record(ctx, s.pool, event)
}
func (s *Store) RecordTx(ctx context.Context, tx pgx.Tx, event Event) error {
	return record(ctx, tx, event)
}
func record(ctx context.Context, db executor, event Event) error {
	if event.Outcome == "" {
		event.Outcome = OutcomeOK
	}
	if event.Metadata == nil {
		event.Metadata = map[string]any{}
	}
	if err := ValidateMetadata(event.Metadata); err != nil {
		return err
	}
	payload, err := json.Marshal(event.Metadata)
	if err != nil {
		return fmt.Errorf("marshal audit metadata: %w", err)
	}
	var requestID any
	if event.RequestID != uuid.Nil {
		requestID = event.RequestID
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO admin_audit_log (
			employee_id, actor_email, action, object_type, object_ref, outcome, request_id, ip, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		event.EmployeeID, nullString(event.ActorEmail), event.Action,
		nullString(event.ObjectType), nullString(event.ObjectRef), event.Outcome,
		requestID, inetArg(event.IP), payload,
	); err != nil {
		return fmt.Errorf("insert audit event: %w", err)
	}
	return nil
}

// PruneBefore deletes audit entries created before the cutoff and returns the
// number of deleted rows. Audit entries are independent of the employees they
// reference and are pruned by age only.
func (s *Store) PruneBefore(ctx context.Context, before time.Time) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tag, err := s.pool.Exec(ctx, `DELETE FROM admin_audit_log WHERE created_at < $1`, before.UTC())
	if err != nil {
		return 0, fmt.Errorf("prune audit log: %w", err)
	}
	return tag.RowsAffected(), nil
}

// CountBefore reports how many audit entries PruneBefore would delete without
// touching them (dry run).
func (s *Store) CountBefore(ctx context.Context, before time.Time) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	var count int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM admin_audit_log WHERE created_at < $1`, before.UTC()).Scan(&count); err != nil {
		return 0, fmt.Errorf("count audit log for prune: %w", err)
	}
	return count, nil
}

func (s *Store) List(ctx context.Context, filter ListFilter) ([]Entry, *string, int, error) {
	limit := filter.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	args := make([]any, 0, 6)
	conditions := make([]string, 0, 4)
	if filter.EmployeeID != nil {
		args = append(args, *filter.EmployeeID)
		conditions = append(conditions, fmt.Sprintf("employee_id = $%d", len(args)))
	}
	if action := strings.TrimSpace(filter.Action); action != "" {
		args = append(args, action)
		conditions = append(conditions, fmt.Sprintf("action = $%d", len(args)))
	}
	if refs := compactStrings(filter.ObjectRefs); len(refs) > 0 {
		args = append(args, refs)
		conditions = append(conditions, fmt.Sprintf("object_ref = ANY($%d)", len(args)))
	}
	if filter.Cursor != "" {
		createdAt, id, err := decodeCursor(filter.Cursor)
		if err != nil {
			return nil, nil, 0, err
		}
		args = append(args, createdAt, id)
		conditions = append(conditions, fmt.Sprintf("(created_at, id) < ($%d, $%d)", len(args)-1, len(args)))
	}
	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	countQuery := "SELECT count(*) FROM admin_audit_log " + where
	var total int
	if err := s.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, nil, 0, fmt.Errorf("count audit: %w", err)
	}

	args = append(args, limit+1)
	query := fmt.Sprintf(`
		SELECT id, employee_id, actor_email, action, object_type, object_ref, outcome, request_id,
		       host(ip)::text, metadata, created_at
		FROM admin_audit_log
		%s
		ORDER BY created_at DESC, id DESC
		LIMIT $%d`, where, len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("list audit: %w", err)
	}
	defer rows.Close()
	items := make([]Entry, 0, limit)
	for rows.Next() {
		var item Entry
		if err := rows.Scan(
			&item.ID, &item.EmployeeID, &item.ActorEmail, &item.Action, &item.ObjectType, &item.ObjectRef,
			&item.Outcome, &item.RequestID, &item.IP, &item.Metadata, &item.CreatedAt,
		); err != nil {
			return nil, nil, 0, fmt.Errorf("scan audit: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, 0, fmt.Errorf("iterate audit: %w", err)
	}
	var next *string
	if len(items) > limit {
		last := items[limit-1]
		cursor := encodeCursor(last.CreatedAt, last.ID)
		next = &cursor
		items = items[:limit]
	}
	return items, next, total, nil
}

func walkMetadata(value any) error {
	switch node := value.(type) {
	case map[string]any:
		for key, child := range node {
			lower := strings.ToLower(key)
			for _, part := range forbiddenKeyParts {
				if strings.Contains(lower, part) {
					return ErrForbiddenMetadata
				}
			}
			if err := walkMetadata(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range node {
			if err := walkMetadata(child); err != nil {
				return err
			}
		}
	}
	return nil
}

func encodeCursor(at time.Time, id int64) string {
	raw := at.UTC().Format(time.RFC3339Nano) + "|" + strconv.FormatInt(id, 10)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeCursor(raw string) (time.Time, int64, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return time.Time{}, 0, ErrInvalidCursor
	}
	parts := strings.Split(string(decoded), "|")
	if len(parts) != 2 {
		return time.Time{}, 0, ErrInvalidCursor
	}
	at, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, 0, ErrInvalidCursor
	}
	id, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return time.Time{}, 0, ErrInvalidCursor
	}
	return at, id, nil
}

func compactStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func nullString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func inetArg(ip string) any {
	if ip == "" {
		return nil
	}
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return nil
	}
	return addr
}

// EntryCursor resumes an audit list strictly after the given entry.
func EntryCursor(entry Entry) string { return encodeCursor(entry.CreatedAt, entry.ID) }
