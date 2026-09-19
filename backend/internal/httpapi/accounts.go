package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/sk1fy/amocrm-pro-admin/internal/accounts"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

func (h *api) listAccounts(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	limit, err := parseLimitParam(query.Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	verification := strings.TrimSpace(query.Get("verification"))
	switch verification {
	case "", "ok", "stale", "unknown", "failed":
	default:
		httpx.WriteError(w, r, httpx.InvalidArgument("invalid verification filter"))
		return
	}
	result, err := h.accounts.ListAccounts(r.Context(), adminActor(r), accounts.ListFilter{
		Verification:  verification,
		Q:             query.Get("q"),
		IntegrationID: strings.TrimSpace(query.Get("integration_id")),
		Product:       strings.TrimSpace(query.Get("product")),
		Connection:    strings.TrimSpace(query.Get("connection")),
		Problem:       strings.TrimSpace(query.Get("problem")),
		Origin:        strings.TrimSpace(query.Get("origin")),
		Backend:       strings.TrimSpace(query.Get("backend")),
		Limit:         limit,
		Cursor:        strings.TrimSpace(query.Get("cursor")),
	})
	if err != nil {
		writeAdapterError(w, r, err)
		return
	}
	items := make([]accountListItemDTO, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, toAccountListItem(item))
	}
	httpx.WriteJSON(w, http.StatusOK, sourcedListResponse{
		Items: items, NextCursor: result.NextCursor, Total: result.Total, Sources: result.Sources,
	})
}

func (h *api) getAccount(w http.ResponseWriter, r *http.Request) {
	accountID, err := parseAccountIDParam(chi.URLParam(r, "account_id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	card, err := h.accounts.GetAccount(r.Context(), adminActor(r), accountID)
	if err != nil {
		writeAdapterError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toAccountCard(card))
}

func (h *api) getAccountSubscription(w http.ResponseWriter, r *http.Request) {
	accountID, err := parseAccountIDParam(chi.URLParam(r, "account_id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	backends := make([]adapter.Backend, 0)
	for _, backend := range h.registry.Backends() {
		if _, ok := adapter.AsSubscription(backend); ok {
			backends = append(backends, backend)
		}
	}
	items := make([]subscriptionObservationDTO, 0)
	sources := make([]adapter.SourceStatus, 0)
	if len(backends) > 0 {
		actor := adminActor(r)
		gathered := adapter.Gather(r.Context(), backends, func(ctx context.Context, backend adapter.Backend) (adapter.Observation[adapter.Subscription], error) {
			subscription, _ := adapter.AsSubscription(backend)
			return subscription.GetSubscription(ctx, actor, accountID)
		})
		if gathered.Invalid != nil {
			writeAdapterError(w, r, gathered.Invalid)
			return
		}
		sources = append(sources, gathered.Sources...)
		for _, obs := range gathered.Items {
			items = append(items, toSubscriptionObservationDTO(obs))
		}
	}
	httpx.WriteJSON(w, http.StatusOK, subscriptionListResponse{Items: items, Sources: sources})
}

func (h *api) accountHistory(w http.ResponseWriter, r *http.Request) {
	accountID, err := parseAccountIDParam(chi.URLParam(r, "account_id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	limit, err := parseLimitParam(r.URL.Query().Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	result, err := h.accounts.History(r.Context(), adminActor(r), accountID, limit, strings.TrimSpace(r.URL.Query().Get("cursor")))
	if err != nil {
		writeAdapterError(w, r, err)
		return
	}
	items := make([]historyItemDTO, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, toHistoryDTO(item))
	}
	httpx.WriteJSON(w, http.StatusOK, sourcedListResponse{
		Items: items, NextCursor: result.NextCursor, Sources: result.Sources,
	})
}

func (h *api) accountJobs(w http.ResponseWriter, r *http.Request) {
	accountID, err := parseAccountIDParam(chi.URLParam(r, "account_id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	limit, err := parseLimitParam(r.URL.Query().Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	result, err := h.accounts.Jobs(r.Context(), adminActor(r), accountID, adapter.JobFilter{
		Limit: limit, Cursor: strings.TrimSpace(r.URL.Query().Get("cursor")),
		Status: strings.TrimSpace(r.URL.Query().Get("status")), Type: strings.TrimSpace(r.URL.Query().Get("type")),
	})
	if err != nil {
		writeAdapterError(w, r, err)
		return
	}
	type accountJobDTO struct {
		jobDTO
		Backend string `json:"backend"`
	}
	items := make([]accountJobDTO, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, accountJobDTO{jobDTO: toJobDTO(item.Job), Backend: item.Backend})
	}
	httpx.WriteJSON(w, http.StatusOK, sourcedListResponse{Items: items, NextCursor: result.NextCursor, Sources: result.Sources})
}
