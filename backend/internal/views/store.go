package views

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound  = errors.New("view not found")
	ErrConflict  = errors.New("view already exists")
	ErrInvalid   = errors.New("invalid view")
	ErrForbidden = errors.New("insufficient permissions")
)

const (
	SectionAccounts   = "accounts"
	SectionOperations = "operations"
	SectionStats      = "stats"
)

type View struct {
	OwnerEmployeeID *uuid.UUID
	ID              uuid.UUID
	Section         string
	Name            string
	Params          json.RawMessage
	Columns         json.RawMessage
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type CreateInput struct {
	OwnerEmployeeID *uuid.UUID
	Section         string
	Name            string
	Params          json.RawMessage
	Columns         json.RawMessage
}

type UpdateInput struct {
	Name    *string
	Params  json.RawMessage
	Columns json.RawMessage
}

type Store struct {
	pool    *pgxpool.Pool
	timeout time.Duration
}

func NewStore(pool *pgxpool.Pool, timeout time.Duration) *Store {
	return &Store{pool: pool, timeout: timeout}
}

func ValidSection(section string) bool {
	switch section {
	case SectionAccounts, SectionOperations, SectionStats:
		return true
	default:
		return false
	}
}

func (s *Store) List(ctx context.Context, employeeID uuid.UUID, section string) ([]View, error) {
	if !ValidSection(section) {
		return nil, ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT id, owner_employee_id, section, name, params, columns, created_at, updated_at
		FROM saved_views
		WHERE section=$1 AND (owner_employee_id=$2 OR owner_employee_id IS NULL)
		ORDER BY owner_employee_id NULLS LAST, name`, section, employeeID)
	if err != nil {
		return nil, fmt.Errorf("list views: %w", err)
	}
	defer rows.Close()
	items := []View{}
	for rows.Next() {
		item, err := scanView(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) Create(ctx context.Context, in CreateInput) (View, error) {
	name := strings.TrimSpace(in.Name)
	if !ValidSection(in.Section) || name == "" {
		return View{}, ErrInvalid
	}
	params := normalizeObject(in.Params)
	columns := normalizeArray(in.Columns)
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	var item View
	err := s.pool.QueryRow(ctx, `
		INSERT INTO saved_views (owner_employee_id, section, name, params, columns)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, owner_employee_id, section, name, params, columns, created_at, updated_at`,
		in.OwnerEmployeeID, in.Section, name, params, columns,
	).Scan(&item.ID, &item.OwnerEmployeeID, &item.Section, &item.Name, &item.Params, &item.Columns, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		if isUnique(err) {
			return View{}, ErrConflict
		}
		return View{}, fmt.Errorf("create view: %w", err)
	}
	return item, nil
}

func (s *Store) Get(ctx context.Context, id uuid.UUID) (View, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	item, err := scanView(s.pool.QueryRow(ctx, `
		SELECT id, owner_employee_id, section, name, params, columns, created_at, updated_at
		FROM saved_views WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return View{}, ErrNotFound
	}
	return item, err
}

func (s *Store) Update(ctx context.Context, id uuid.UUID, in UpdateInput) (View, error) {
	current, err := s.Get(ctx, id)
	if err != nil {
		return View{}, err
	}
	name := current.Name
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
		if name == "" {
			return View{}, ErrInvalid
		}
	}
	params := current.Params
	if in.Params != nil {
		params = normalizeObject(in.Params)
	}
	columns := current.Columns
	if in.Columns != nil {
		columns = normalizeArray(in.Columns)
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	item, err := scanView(s.pool.QueryRow(ctx, `
		UPDATE saved_views SET name=$2, params=$3, columns=$4 WHERE id=$1
		RETURNING id, owner_employee_id, section, name, params, columns, created_at, updated_at`,
		id, name, params, columns))
	if errors.Is(err, pgx.ErrNoRows) {
		return View{}, ErrNotFound
	}
	if isUnique(err) {
		return View{}, ErrConflict
	}
	return item, err
}

func (s *Store) Delete(ctx context.Context, id uuid.UUID) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tag, err := s.pool.Exec(ctx, `DELETE FROM saved_views WHERE id=$1`, id)
	if err != nil {
		return fmt.Errorf("delete view: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func CanWrite(view View, employeeID uuid.UUID, role string) bool {
	if view.OwnerEmployeeID != nil && *view.OwnerEmployeeID == employeeID {
		return true
	}
	return view.OwnerEmployeeID == nil && role == "admin"
}

type scanner interface {
	Scan(dest ...any) error
}

func scanView(row scanner) (View, error) {
	var item View
	err := row.Scan(&item.ID, &item.OwnerEmployeeID, &item.Section, &item.Name, &item.Params, &item.Columns, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func normalizeObject(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage(`{}`)
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return json.RawMessage(`{}`)
	}
	if _, ok := value.(map[string]any); !ok {
		return json.RawMessage(`{}`)
	}
	return raw
}

func normalizeArray(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage(`[]`)
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return json.RawMessage(`[]`)
	}
	if _, ok := value.([]any); !ok {
		return json.RawMessage(`[]`)
	}
	return raw
}

func isUnique(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
