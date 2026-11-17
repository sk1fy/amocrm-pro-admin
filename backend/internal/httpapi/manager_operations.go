package httpapi

import (
	"errors"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/managerplatform"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

type managerOperationResponse struct {
	ID        uuid.UUID                    `json:"id"`
	State     managerplatform.State        `json:"state"`
	Operation *managerPlatformOperationDTO `json:"operation,omitempty"`
}

type managerPlatformOperationDTO struct {
	State             string     `json:"state"`
	Kind              string     `json:"kind"`
	TargetID          uuid.UUID  `json:"target_id"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	ResultRef         *uuid.UUID `json:"result_ref,omitempty"`
	RetryAfterSeconds *int       `json:"retry_after_seconds,omitempty"`
}

func managerOperation(service *managerplatform.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil || id == uuid.Nil {
			httpx.WriteError(w, r, httpx.InvalidArgument("invalid operation id"))
			return
		}
		principal, _ := auth.PrincipalFromContext(r.Context())
		if !slices.Contains(principal.Account.ManagerGrants, auth.GrantClientsRead) {
			httpx.WriteError(w, r, httpx.Forbidden("operation access denied"))
			return
		}
		if service == nil {
			httpx.WriteError(w, r, httpx.BackendUnavailable("Platform unavailable"))
			return
		}
		result, err := service.GetOperation(r.Context(), id)
		if err != nil {
			writeManagerOperationError(w, r, err)
			return
		}
		response := managerOperationResponse{ID: result.ID, State: result.State}
		if op := result.Operation; op != nil {
			response.Operation = &managerPlatformOperationDTO{
				State: string(op.State), Kind: op.Kind, TargetID: op.Target.Id,
				CreatedAt: op.CreatedAt.UTC(), UpdatedAt: op.UpdatedAt.UTC(),
				ResultRef: op.ResultRef, RetryAfterSeconds: op.RetryAfterSeconds,
			}
		}
		httpx.WriteJSON(w, http.StatusOK, response)
	}
}

func writeManagerOperationError(w http.ResponseWriter, r *http.Request, err error) {
	var peer *managerplatform.PeerError
	switch {
	case errors.Is(err, auth.ErrUnauthenticated):
		httpx.WriteError(w, r, httpx.Unauthenticated("authentication required"))
	case errors.Is(err, managerplatform.ErrForbidden):
		httpx.WriteError(w, r, httpx.Forbidden("operation access denied"))
	case errors.Is(err, managerplatform.ErrNotFound):
		httpx.WriteError(w, r, httpx.NotFound("operation not found"))
	case errors.Is(err, managerplatform.ErrUnavailable):
		httpx.WriteError(w, r, httpx.BackendUnavailable("Platform unavailable"))
	case errors.As(err, &peer):
		if (peer.Status == http.StatusTooManyRequests || peer.Status == http.StatusServiceUnavailable) &&
			peer.RetryAfter != nil && *peer.RetryAfter >= 0 {
			w.Header().Set("Retry-After", strconv.Itoa(*peer.RetryAfter))
		}
		switch peer.Status {
		case http.StatusForbidden:
			httpx.WriteError(w, r, httpx.Forbidden("operation access denied"))
		case http.StatusNotFound:
			httpx.WriteError(w, r, httpx.NotFound("operation not found"))
		case http.StatusTooManyRequests:
			httpx.WriteError(w, r, httpx.RateLimited("Platform is busy"))
		default:
			httpx.WriteError(w, r, httpx.BackendUnavailable("Platform unavailable"))
		}
	default:
		httpx.WriteError(w, r, httpx.Internal())
	}
}
