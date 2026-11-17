package managerplatform

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/jsonbody"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

var (
	ErrConflict  = errors.New("identical idempotency key has a different command")
	ErrForbidden = errors.New("manager grant required")
	ErrInvalid   = errors.New("invalid manager command")
	ErrNotFound  = errors.New("manager operation not found")
)

const (
	checkInterval = 5 * time.Second
	recheckDelay  = 15 * time.Second
)

type Service struct {
	store
	client   *Client
	sessions *auth.Service
	logger   *slog.Logger
}

func NewService(pool *pgxpool.Pool, timeout time.Duration, audits *audit.Store, sessions *auth.Service,
	client *Client, logger *slog.Logger,
) *Service {
	return &Service{store: store{pool: pool, timeout: timeout, audit: audits}, client: client, sessions: sessions, logger: logger}
}

type CommandMeta struct {
	TargetID, IdempotencyKey uuid.UUID
	ExpectedVersion          int64
}

type State string

const (
	UnknownOutcome State = "unknown_outcome"
	ReceiptDone    State = "completed"
	ReceiptDenied  State = "rejected"
	PlatformResult State = "platform_operation"
)

type Result struct {
	ID           uuid.UUID
	State        State
	Operation    *wire.Operation
	Installation *wire.Installation
	RetryAfter   *int
}

func (s *Service) SetInstallationReview(ctx context.Context, meta CommandMeta, body wire.SetInstallationReviewJSONRequestBody) (Result, error) {
	if body.Reason != nil && !validReason(*body.Reason) {
		return Result{}, ErrInvalid
	}
	return s.send(ctx, kindReview, meta, body, func(ctx context.Context, p auth.Principal, item intent) (Result, error) {
		installation, err := s.client.review(ctx, p, item, body)
		return Result{ID: item.ID, State: ReceiptDone, Installation: installation}, err
	})
}

func (s *Service) RetryInstallationDeal(ctx context.Context, meta CommandMeta, body wire.RetryInstallationDealJSONRequestBody) (Result, error) {
	if !validReason(body.Reason) {
		return Result{}, ErrInvalid
	}
	return s.send(ctx, kindRetryDeal, meta, body, func(ctx context.Context, p auth.Principal, item intent) (Result, error) {
		operation, err := s.client.retryDeal(ctx, p, item, body)
		return Result{ID: item.ID, State: PlatformResult, Operation: operation}, err
	})
}

func validReason(reason string) bool {
	return utf8.ValidString(reason) && !strings.ContainsRune(reason, 0) && len(reason) > 0 && utf8.RuneCountInString(reason) <= 1000
}

func (s *Service) send(ctx context.Context, kind string, meta CommandMeta, body any,
	dispatch func(context.Context, auth.Principal, intent) (Result, error),
) (Result, error) {
	if meta.IdempotencyKey == uuid.Nil || meta.TargetID == uuid.Nil || meta.ExpectedVersion < 1 || meta.ExpectedVersion > MaxVersion {
		return Result{}, ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, maxTimeout)
	defer cancel()
	identity, ok := auth.PrincipalFromContext(ctx)
	if !ok || identity.Audience != auth.Managers {
		return Result{}, auth.ErrUnauthenticated
	}
	actor, err := s.snapshot(ctx, identity.SessionID, identity.EmployeeID, auth.GrantClientsWrite)
	if err != nil {
		return Result{}, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return Result{}, fmt.Errorf("marshal manager command: %w", err)
	}
	normalized, err := jsonbody.CanonicalObject(raw)
	if err != nil {
		return Result{}, fmt.Errorf("canonicalize manager command: %w", err)
	}
	hash := sha256.Sum256(normalized)
	item, created, err := s.admit(ctx, actor, intent{
		Kind: kind, TargetID: meta.TargetID, Version: meta.ExpectedVersion, Key: meta.IdempotencyKey, Hash: hash[:],
	})
	if err != nil {
		return Result{}, err
	}
	unknown := Result{ID: item.ID, State: UnknownOutcome}
	if !created {
		claimed, err := s.claimByID(ctx, &item)
		if err != nil {
			return Result{}, err
		}
		if !claimed {
			return unknown, nil
		}
	}
	delay := recheckDelay
	defer func() { s.finishIntent(ctx, item, delay) }()
	if !created {
		result, err := s.observe(ctx, item, actor.SessionID, auth.GrantClientsWrite)
		if err != nil {
			delay = nextDelay(Result{}, err)
			if !isTransient(err) {
				return Result{}, err
			}
			setRetryAfter(&unknown, err)
			return unknown, nil
		}
		if result.Operation != nil {
			delay = nextDelay(result, nil)
			return result, nil
		}
		// This is an identical user resubmission. The original IDs and body
		// let Platform resolve a command still in flight or replay a sync outcome.
	}
	actor, err = s.snapshot(ctx, actor.SessionID, actor.EmployeeID, auth.GrantClientsWrite)
	if err != nil {
		return Result{}, err
	}
	result, err := dispatch(ctx, actor, item)
	delay = nextDelay(result, err)
	if _, err := s.snapshot(context.WithoutCancel(ctx), actor.SessionID, actor.EmployeeID, auth.GrantClientsWrite); err != nil {
		return Result{}, err
	}
	if isTransient(err) {
		setRetryAfter(&unknown, err)
		return unknown, nil
	}
	return result, err
}

func (s *Service) GetOperation(ctx context.Context, id uuid.UUID) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, maxTimeout)
	defer cancel()
	identity, ok := auth.PrincipalFromContext(ctx)
	if !ok || identity.Audience != auth.Managers {
		return Result{}, auth.ErrUnauthenticated
	}
	actor, err := s.snapshot(ctx, identity.SessionID, identity.EmployeeID, auth.GrantClientsRead)
	if err != nil {
		return Result{}, err
	}
	item, err := s.owned(ctx, id, actor.EmployeeID)
	if err != nil {
		return Result{}, err
	}
	return s.observe(ctx, item, actor.SessionID, auth.GrantClientsRead)
}

func (s *Service) snapshot(ctx context.Context, sessionID, employeeID uuid.UUID, required auth.ManagerGrant) (auth.Principal, error) {
	actor, err := s.sessions.ManagerSnapshot(ctx, sessionID)
	if err != nil {
		return auth.Principal{}, err
	}
	if actor.EmployeeID != employeeID {
		return auth.Principal{}, auth.ErrUnauthenticated
	}
	if !hasGrant(actor, required) {
		return auth.Principal{}, ErrForbidden
	}
	return actor, nil
}

func hasGrant(actor auth.Principal, grant auth.ManagerGrant) bool {
	return slices.Contains(actor.Account.ManagerGrants, grant)
}

func (s *Service) observe(ctx context.Context, item intent, sessionID uuid.UUID, required auth.ManagerGrant) (Result, error) {
	actor, err := s.snapshot(ctx, sessionID, item.EmployeeID, required)
	if err != nil {
		return Result{}, err
	}
	if item.Kind == kindReview && !hasGrant(actor, auth.GrantClientsWrite) {
		return Result{}, ErrForbidden
	}
	if hasGrant(actor, auth.GrantClientsWrite) {
		receipt, err := s.client.receipt(ctx, actor, item.ID)
		if err != nil {
			var peer *PeerError
			if errors.As(err, &peer) && peer.Status == http.StatusNotFound {
				if err := s.confirmReceiptAccess(ctx, item, sessionID, required); err != nil {
					return Result{}, err
				}
				return Result{ID: item.ID, State: UnknownOutcome}, nil
			}
			return Result{}, err
		}
		if receipt.Kind != item.Kind || (item.Kind == kindReview && receipt.OperationId != nil) {
			return Result{}, ErrUnavailable
		}
		if receipt.OperationId == nil {
			if err := s.confirmReceiptAccess(ctx, item, sessionID, required); err != nil {
				return Result{}, err
			}
			state := ReceiptDone
			if receipt.State == wire.CommandReceiptStateRejected {
				state = ReceiptDenied
			}
			return Result{ID: item.ID, State: state}, nil
		}
	}
	actor, err = s.snapshot(ctx, sessionID, item.EmployeeID, auth.GrantClientsRead)
	if err != nil {
		return Result{}, err
	}
	operation, err := s.client.operation(ctx, actor, item)
	if err != nil {
		return Result{}, err
	}
	if _, err := s.snapshot(ctx, sessionID, item.EmployeeID, required); err != nil {
		return Result{}, err
	}
	return Result{ID: item.ID, State: PlatformResult, Operation: operation}, nil
}

func (s *Service) confirmReceiptAccess(ctx context.Context, item intent, sessionID uuid.UUID, required auth.ManagerGrant) error {
	actor, err := s.snapshot(ctx, sessionID, item.EmployeeID, required)
	if err != nil {
		return err
	}
	if item.Kind == kindReview && !hasGrant(actor, auth.GrantClientsWrite) {
		return ErrForbidden
	}
	return nil
}

func setRetryAfter(result *Result, err error) {
	var peer *PeerError
	if errors.As(err, &peer) {
		result.RetryAfter = peer.RetryAfter
	}
}

func isTransient(err error) bool {
	if errors.Is(err, ErrUnavailable) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}
	var peer *PeerError
	return errors.As(err, &peer) && (peer.Status == http.StatusServiceUnavailable || peer.OutcomeUnknown)
}

func nextDelay(result Result, err error) time.Duration {
	var peer *PeerError
	if errors.As(err, &peer) && peer.RetryAfter != nil && *peer.RetryAfter > 0 {
		return delaySeconds(*peer.RetryAfter)
	}
	if errors.As(err, &peer) && peer.Status == http.StatusNotFound {
		return recheckDelay
	}
	if isTransient(err) || result.State == UnknownOutcome {
		return recheckDelay
	}
	if result.Operation != nil {
		switch result.Operation.State {
		case wire.OperationStateSucceeded, wire.OperationStateFailed, wire.OperationStateNeedsReview:
			return 0
		default:
			if delay := result.Operation.RetryAfterSeconds; delay != nil && *delay > 0 {
				return delaySeconds(*delay)
			}
			return recheckDelay
		}
	}
	return 0
}

func delaySeconds(seconds int) time.Duration {
	if int64(seconds) > math.MaxInt64/int64(time.Second) {
		return math.MaxInt64
	}
	return time.Duration(seconds) * time.Second
}

func (s *Service) finishIntent(ctx context.Context, item intent, delay time.Duration) {
	if err := s.finish(ctx, item, delay); err != nil {
		s.logger.Warn("manager intent lease update failed", "command_id", item.ID)
	}
}

func (s *Service) Reconcile(ctx context.Context) {
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()
	for {
		s.reconcileNext(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) reconcileNext(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, maxTimeout)
	defer cancel()
	item, err := s.claimNext(ctx)
	if err != nil {
		if !errors.Is(err, ErrNotFound) && !errors.Is(err, context.Canceled) {
			s.logger.Warn("manager intent lease failed")
		}
		return
	}
	result, err := s.observe(ctx, item, item.SessionID, auth.GrantClientsRead)
	delay := nextDelay(result, err)
	if err != nil && !errors.Is(err, auth.ErrUnauthenticated) && !errors.Is(err, ErrForbidden) && delay == 0 {
		var peer *PeerError
		if !errors.As(err, &peer) || (peer.Status != http.StatusForbidden && peer.Status != http.StatusUnauthorized) {
			delay = recheckDelay
		}
	}
	s.finishIntent(ctx, item, delay)
}
