package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

// getAccountCRMUsers reads amoCRM users of an account through every backend
// with the crm-users capability. Each backend keeps its own snapshot; this
// handler neither caches nor polls. A backend that cannot read amoCRM answers
// with a state and no list, and a failed backend is reported as a source.
func (h *api) getAccountCRMUsers(w http.ResponseWriter, r *http.Request) {
	accountID, err := parseAccountIDParam(chi.URLParam(r, "account_id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	backends := make([]adapter.Backend, 0)
	for _, backend := range h.registry.Backends() {
		if _, ok := adapter.AsCRMUsers(backend); ok {
			backends = append(backends, backend)
		}
	}
	items := make([]crmUsersObservationDTO, 0)
	sources := make([]adapter.SourceStatus, 0)
	if len(backends) > 0 {
		actor := adminActor(r)
		gathered := adapter.GatherWithin(r.Context(), backends, func(backend adapter.Backend) time.Duration {
			users, _ := adapter.AsCRMUsers(backend)
			return users.CRMUsersTimeout()
		}, func(ctx context.Context, backend adapter.Backend) (adapter.Observation[adapter.CRMUsers], error) {
			users, _ := adapter.AsCRMUsers(backend)
			return users.GetCRMUsers(ctx, actor, accountID)
		})
		if gathered.Invalid != nil {
			writeAdapterError(w, r, gathered.Invalid)
			return
		}
		sources = append(sources, gathered.Sources...)
		for _, obs := range gathered.Items {
			items = append(items, toCRMUsersObservationDTO(obs))
		}
	}
	// Names of client employees: never keep them in shared or browser caches.
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, crmUsersListResponse{Items: items, Sources: sources})
}

type crmUserDTO struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	IsActive bool   `json:"is_active"`
	IsAdmin  bool   `json:"is_admin"`
}

type crmUsersConnectionDTO struct {
	ID              string `json:"id"`
	IntegrationID   string `json:"integration_id"`
	IntegrationCode string `json:"integration_code"`
}

// crmUsersDTO keeps users and total null unless state is ok: null is an
// unknown list, an empty array is an account without users.
type crmUsersDTO struct {
	State             string                 `json:"state"`
	Raw               string                 `json:"raw,omitempty"`
	Connection        *crmUsersConnectionDTO `json:"connection"`
	FreshUntil        *time.Time             `json:"fresh_until"`
	RetryAfterSeconds *int64                 `json:"retry_after_seconds"`
	Users             []crmUserDTO           `json:"users"`
	Total             *int                   `json:"total"`
}

type crmUsersObservationDTO struct {
	Source     string            `json:"source"`
	ObservedAt time.Time         `json:"observed_at"`
	Freshness  string            `json:"freshness"`
	Error      *adapter.ObsError `json:"error,omitempty"`
	Data       *crmUsersDTO      `json:"data,omitempty"`
}

type crmUsersListResponse struct {
	Items   []crmUsersObservationDTO `json:"items"`
	Sources []adapter.SourceStatus   `json:"sources"`
}

func toCRMUsersObservationDTO(obs adapter.Observation[adapter.CRMUsers]) crmUsersObservationDTO {
	dto := crmUsersObservationDTO{
		Source: obs.Source, ObservedAt: obs.ObservedAt.UTC(), Freshness: obs.Freshness, Error: obs.Error,
	}
	if obs.Data != nil {
		data := toCRMUsersDTO(*obs.Data)
		dto.Data = &data
	}
	return dto
}

func toCRMUsersDTO(item adapter.CRMUsers) crmUsersDTO {
	dto := crmUsersDTO{State: item.State.Canonical, Raw: item.State.Raw}
	if item.Connection != nil {
		dto.Connection = &crmUsersConnectionDTO{
			ID: item.Connection.ID, IntegrationID: item.Connection.IntegrationID, IntegrationCode: item.Connection.IntegrationCode,
		}
	}
	if item.RetryAfter != nil {
		seconds := int64((*item.RetryAfter + time.Second - 1) / time.Second)
		dto.RetryAfterSeconds = &seconds
	}
	if item.State.Canonical != adapter.CRMUsersOK || item.Users == nil {
		return dto
	}
	if item.FreshUntil != nil {
		freshUntil := item.FreshUntil.UTC()
		dto.FreshUntil = &freshUntil
	}
	dto.Users = make([]crmUserDTO, 0, len(item.Users))
	for _, user := range item.Users {
		dto.Users = append(dto.Users, crmUserDTO{ID: user.ID, Name: user.Name, IsActive: user.IsActive, IsAdmin: user.IsAdmin})
	}
	total := len(dto.Users)
	dto.Total = &total
	return dto
}
