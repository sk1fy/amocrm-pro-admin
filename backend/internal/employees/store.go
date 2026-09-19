package employees

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
)

var (
	ErrNotFound = errors.New("employee not found")
	ErrConflict = errors.New("employee already exists")
)

type Store struct {
	pool    *pgxpool.Pool
	timeout time.Duration
}

type Employee struct {
	ID        uuid.UUID
	Email     string
	Name      string
	Role      string
	Status    string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type CreateInput struct {
	Email        string
	Name         string
	Role         string
	PasswordHash string
}

type UpdateInput struct {
	Name   *string
	Role   *string
	Status *string
}

func NewStore(pool *pgxpool.Pool, timeout time.Duration) *Store {
	return &Store{pool: pool, timeout: timeout}
}

func (s *Store) Create(ctx context.Context, in CreateInput) (Employee, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	return s.CreateTx(ctx, s.pool, in)
}

type rowQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (s *Store) CreateTx(ctx context.Context, db rowQuerier, in CreateInput) (Employee, error) {
	var emp Employee
	err := db.QueryRow(ctx, `
		INSERT INTO employees (email, name, role, password_hash, status)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, email, name, role, status, created_at, updated_at`,
		in.Email, in.Name, in.Role, in.PasswordHash, auth.StatusActive,
	).Scan(&emp.ID, &emp.Email, &emp.Name, &emp.Role, &emp.Status, &emp.CreatedAt, &emp.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return Employee{}, ErrConflict
		}
		return Employee{}, fmt.Errorf("create employee: %w", err)
	}
	return emp, nil
}

func (s *Store) Get(ctx context.Context, id uuid.UUID) (rbac.Employee, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	var emp rbac.Employee
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, name, role, status
		FROM employees
		WHERE id = $1`, id).Scan(&emp.ID, &emp.Email, &emp.Name, &emp.Role, &emp.Status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return rbac.Employee{}, ErrNotFound
		}
		return rbac.Employee{}, fmt.Errorf("get employee: %w", err)
	}
	return emp, nil
}

func (s *Store) GetRecord(ctx context.Context, id uuid.UUID) (Employee, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	var emp Employee
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, name, role, status, created_at, updated_at
		FROM employees
		WHERE id = $1`, id).Scan(&emp.ID, &emp.Email, &emp.Name, &emp.Role, &emp.Status, &emp.CreatedAt, &emp.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Employee{}, ErrNotFound
		}
		return Employee{}, fmt.Errorf("get employee record: %w", err)
	}
	return emp, nil
}

func (s *Store) GetByEmail(ctx context.Context, email string) (Employee, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	var emp Employee
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, name, role, status, created_at, updated_at
		FROM employees
		WHERE email = $1`, email).Scan(&emp.ID, &emp.Email, &emp.Name, &emp.Role, &emp.Status, &emp.CreatedAt, &emp.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Employee{}, ErrNotFound
		}
		return Employee{}, fmt.Errorf("get employee by email: %w", err)
	}
	return emp, nil
}

func (s *Store) List(ctx context.Context) ([]Employee, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT id, email, name, role, status, created_at, updated_at
		FROM employees
		ORDER BY created_at ASC, id ASC`)
	if err != nil {
		return nil, fmt.Errorf("list employees: %w", err)
	}
	defer rows.Close()
	items := make([]Employee, 0)
	for rows.Next() {
		var emp Employee
		if err := rows.Scan(&emp.ID, &emp.Email, &emp.Name, &emp.Role, &emp.Status, &emp.CreatedAt, &emp.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan employee: %w", err)
		}
		items = append(items, emp)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate employees: %w", err)
	}
	return items, nil
}

// Update serializes read/modify/write even for callers without audit orchestration.
func (s *Store) Update(ctx context.Context, id uuid.UUID, in UpdateInput) (Employee, bool, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Employee{}, false, false, fmt.Errorf("begin employee update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	before, emp, err := s.UpdateTx(ctx, tx, id, in)
	if err != nil {
		return Employee{}, false, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Employee{}, false, false, fmt.Errorf("commit employee update: %w", err)
	}
	return emp, before.Role != emp.Role, before.Status != emp.Status, nil
}

func (s *Store) lockRecord(ctx context.Context, tx pgx.Tx, id uuid.UUID) (Employee, error) {
	var emp Employee
	err := tx.QueryRow(ctx, `
		SELECT id, email, name, role, status, created_at, updated_at
		FROM employees WHERE id = $1 FOR UPDATE`, id).Scan(
		&emp.ID, &emp.Email, &emp.Name, &emp.Role, &emp.Status, &emp.CreatedAt, &emp.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Employee{}, ErrNotFound
	}
	if err != nil {
		return Employee{}, fmt.Errorf("lock employee: %w", err)
	}
	return emp, nil
}

// UpdateTx returns the state read under the row lock for a consistent audit diff.
func (s *Store) UpdateTx(ctx context.Context, tx pgx.Tx, id uuid.UUID, in UpdateInput) (Employee, Employee, error) {
	before, err := s.lockRecord(ctx, tx, id)
	if err != nil {
		return Employee{}, Employee{}, err
	}
	var name *string
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		name = &trimmed
	}
	var emp Employee
	err = tx.QueryRow(ctx, `
		UPDATE employees
		SET name = COALESCE($2, name), role = COALESCE($3, role), status = COALESCE($4, status)
		WHERE id = $1
		RETURNING id, email, name, role, status, created_at, updated_at`,
		id, name, in.Role, in.Status,
	).Scan(&emp.ID, &emp.Email, &emp.Name, &emp.Role, &emp.Status, &emp.CreatedAt, &emp.UpdatedAt)
	if err != nil {
		return Employee{}, Employee{}, fmt.Errorf("update employee: %w", err)
	}
	return before, emp, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
