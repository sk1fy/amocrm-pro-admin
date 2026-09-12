package auth

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	StatusActive   = "active"
	StatusDisabled = "disabled"

	ReasonLogout     = "logout"
	ReasonAdmin      = "admin"
	ReasonRoleChange = "role_change"
	ReasonDisabled   = "disabled"
	ReasonExpired    = "expired"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUnauthenticated    = errors.New("unauthenticated")
	ErrNotFound           = errors.New("not found")
)

type Service struct {
	pool         *pgxpool.Pool
	timeout      time.Duration
	absoluteTTL  time.Duration
	idleTTL      time.Duration
	cookieSecure bool
}

type Account struct {
	ID     uuid.UUID
	Email  string
	Name   string
	Role   string
	Status string
}

type Session struct {
	ID           uuid.UUID
	EmployeeID   uuid.UUID
	CreatedAt    time.Time
	LastSeenAt   time.Time
	ExpiresAt    time.Time
	RevokedAt    *time.Time
	RevokeReason *string
	IP           *string
	UserAgent    *string
}

type Principal struct {
	SessionID  uuid.UUID
	EmployeeID uuid.UUID
	Account    Account
}

func NewService(pool *pgxpool.Pool, timeout, absoluteTTL, idleTTL time.Duration, cookieSecure bool) *Service {
	return &Service{
		pool:         pool,
		timeout:      timeout,
		absoluteTTL:  absoluteTTL,
		idleTTL:      idleTTL,
		cookieSecure: cookieSecure,
	}
}

func (s *Service) Login(ctx context.Context, email, password, ip, userAgent string) (string, Account, error) {
	email = NormalizeEmail(email)
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	account, passwordHash, err := s.lookupByEmail(ctx, email)
	if err != nil {
		_ = Verify(password, dummyPasswordHash())
		return "", Account{}, ErrInvalidCredentials
	}
	hash := ""
	if passwordHash != nil {
		hash = *passwordHash
	}
	if hash == "" || !Verify(password, hash) || account.Status != StatusActive {
		return "", Account{}, ErrInvalidCredentials
	}

	plain, tokenHash, err := NewToken()
	if err != nil {
		return "", Account{}, err
	}
	expiresAt := time.Now().UTC().Add(s.absoluteTTL)
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO sessions (employee_id, token_hash, expires_at, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5)`,
		account.ID, tokenHash, expiresAt, inetArg(ip), truncateUA(userAgent),
	); err != nil {
		return "", Account{}, fmt.Errorf("create session: %w", err)
	}
	return plain, account, nil
}

func (s *Service) Lookup(ctx context.Context, token string) (Principal, error) {
	hash, err := HashToken(token)
	if err != nil {
		return Principal{}, ErrUnauthenticated
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	var principal Principal
	var lastSeen, expiresAt time.Time
	var revokedAt *time.Time
	var status string
	err = s.pool.QueryRow(ctx, `
		SELECT s.id, s.employee_id, s.last_seen_at, s.expires_at, s.revoked_at,
		       e.email, e.name, e.role, e.status
		FROM sessions s
		JOIN employees e ON e.id = s.employee_id
		WHERE s.token_hash = $1`, hash).Scan(
		&principal.SessionID, &principal.EmployeeID, &lastSeen, &expiresAt, &revokedAt,
		&principal.Account.Email, &principal.Account.Name, &principal.Account.Role, &status,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Principal{}, ErrUnauthenticated
		}
		return Principal{}, fmt.Errorf("lookup session: %w", err)
	}
	principal.Account.ID = principal.EmployeeID
	principal.Account.Status = status
	now := time.Now().UTC()
	if revokedAt != nil || now.After(expiresAt) || now.After(lastSeen.Add(s.idleTTL)) || status != StatusActive {
		if revokedAt == nil {
			_, _ = s.pool.Exec(ctx, `
				UPDATE sessions
				SET revoked_at = now(), revoke_reason = $2
				WHERE id = $1 AND revoked_at IS NULL`, principal.SessionID, ReasonExpired)
		}
		return Principal{}, ErrUnauthenticated
	}
	if now.Sub(lastSeen) >= time.Minute {
		_, _ = s.pool.Exec(ctx, `
			UPDATE sessions SET last_seen_at = now()
			WHERE id = $1 AND last_seen_at <= now() - interval '1 minute'`, principal.SessionID)
	}
	return principal, nil
}

func (s *Service) Revoke(ctx context.Context, sessionID uuid.UUID, reason string) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tag, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = now(), revoke_reason = $2
		WHERE id = $1 AND revoked_at IS NULL`, sessionID, reason)
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) RevokeOwned(ctx context.Context, sessionID, employeeID uuid.UUID, reason string) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tag, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = now(), revoke_reason = $3
		WHERE id = $1 AND employee_id = $2 AND revoked_at IS NULL`, sessionID, employeeID, reason)
	if err != nil {
		return fmt.Errorf("revoke owned session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) RevokeAll(ctx context.Context, employeeID uuid.UUID, reason string) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	if _, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = now(), revoke_reason = $2
		WHERE employee_id = $1 AND revoked_at IS NULL`, employeeID, reason); err != nil {
		return fmt.Errorf("revoke employee sessions: %w", err)
	}
	return nil
}

func (s *Service) ListOwn(ctx context.Context, employeeID uuid.UUID) ([]Session, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT id, employee_id, created_at, last_seen_at, expires_at, revoked_at, revoke_reason,
		       host(ip)::text, user_agent
		FROM sessions
		WHERE employee_id = $1
		ORDER BY created_at DESC, id DESC`, employeeID)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()
	items := make([]Session, 0)
	for rows.Next() {
		var item Session
		if err := rows.Scan(
			&item.ID, &item.EmployeeID, &item.CreatedAt, &item.LastSeenAt, &item.ExpiresAt,
			&item.RevokedAt, &item.RevokeReason, &item.IP, &item.UserAgent,
		); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sessions: %w", err)
	}
	return items, nil
}

func (s *Service) Cleanup(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	if _, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = now(), revoke_reason = $1
		WHERE revoked_at IS NULL
		  AND (expires_at < now() OR last_seen_at < now() - ($2 * interval '1 millisecond'))`,
		ReasonExpired, s.idleTTL.Milliseconds(),
	); err != nil {
		return fmt.Errorf("expire sessions: %w", err)
	}
	if _, err := s.pool.Exec(ctx, `
		DELETE FROM sessions
		WHERE revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days'`); err != nil {
		return fmt.Errorf("delete old sessions: %w", err)
	}
	return nil
}

func (s *Service) SetCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, s.cookie(token, int(s.absoluteTTL/time.Second)))
}

func (s *Service) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, s.cookie("", -1))
}

func (s *Service) cookie(value string, maxAge int) *http.Cookie {
	if s.cookieSecure {
		return &http.Cookie{
			Name:     CookieName,
			Value:    value,
			Path:     "/",
			MaxAge:   maxAge,
			HttpOnly: true,
			Secure:   true,
			SameSite: http.SameSiteStrictMode,
		}
	}
	return developmentCookie(value, maxAge)
}

func developmentCookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{ //nolint:gosec // G124: Secure is disabled only when APP_ENV=development
		Name:     CookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteStrictMode,
	}
}

func (s *Service) lookupByEmail(ctx context.Context, email string) (Account, *string, error) {
	var account Account
	var hash *string
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, name, role, status, password_hash
		FROM employees
		WHERE email = $1`, email).Scan(
		&account.ID, &account.Email, &account.Name, &account.Role, &account.Status, &hash,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Account{}, nil, ErrNotFound
		}
		return Account{}, nil, fmt.Errorf("lookup employee: %w", err)
	}
	return account, hash, nil
}

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if _, err := netip.ParseAddr(host); err != nil {
		return ""
	}
	return host
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

func truncateUA(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if len(value) > 512 {
		value = value[:512]
	}
	return value
}
