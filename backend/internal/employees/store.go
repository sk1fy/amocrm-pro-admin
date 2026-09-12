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
	var emp Employee
	err := s.pool.QueryRow(ctx, `
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

func (s *Store) Update(ctx context.Context, id uuid.UUID, in UpdateInput) (Employee, bool, bool, error) {
	current, err := s.GetRecord(ctx, id)
	if err != nil {
		return Employee{}, false, false, err
	}
	name := current.Name
	role := current.Role
	status := current.Status
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
	}
	if in.Role != nil {
		role = *in.Role
	}
	if in.Status != nil {
		status = *in.Status
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	var emp Employee
	err = s.pool.QueryRow(ctx, `
		UPDATE employees
		SET name = $2, role = $3, status = $4
		WHERE id = $1
		RETURNING id, email, name, role, status, created_at, updated_at`,
		id, name, role, status,
	).Scan(&emp.ID, &emp.Email, &emp.Name, &emp.Role, &emp.Status, &emp.CreatedAt, &emp.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Employee{}, false, false, ErrNotFound
		}
		return Employee{}, false, false, fmt.Errorf("update employee: %w", err)
	}
	return emp, role != current.Role, status != current.Status, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
