package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

const (
	defaultLimit = 25
	maxLimit     = 100
)

func adminActor(r *http.Request) adapter.Actor {
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		return adapter.Actor{}
	}
	return adapter.EmployeeActor(principal.EmployeeID)
}

func parseLimitParam(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return defaultLimit, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return 0, httpx.InvalidArgument("limit must be a positive integer")
	}
	if value > maxLimit {
		return maxLimit, nil
	}
	return value, nil
}

func parseAccountIDParam(raw string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || id < 1 {
		return 0, httpx.InvalidArgument("account_id must be a positive integer")
	}
	return id, nil
}

func writeAdapterError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, adapter.ErrNotFound):
		httpx.WriteError(w, r, httpx.NotFound("not found"))
	case errors.Is(err, adapter.ErrInvalidArgument):
		httpx.WriteError(w, r, httpx.InvalidArgument(adapter.SafeMessage(err)))
	case errors.Is(err, adapter.ErrTimeout):
		httpx.WriteError(w, r, httpx.BackendTimeout(adapter.SafeMessage(err)))
	case errors.Is(err, adapter.ErrUnavailable):
		httpx.WriteError(w, r, httpx.BackendUnavailable(adapter.SafeMessage(err)))
	default:
		httpx.WriteError(w, r, httpx.Internal())
	}
}
