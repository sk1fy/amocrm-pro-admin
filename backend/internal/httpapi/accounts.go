package httpapi

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/sk1fy/amocrm-pro-admin/internal/accounts"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

func (h *api) listAccounts(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	limit, err := parseLimitParam(query.Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	result, err := h.accounts.ListAccounts(r.Context(), adminActor(r), accounts.ListFilter{
		Q:          query.Get("q"),
		Product:    strings.TrimSpace(query.Get("product")),
		Connection: strings.TrimSpace(query.Get("connection")),
		Problem:    strings.TrimSpace(query.Get("problem")),
		Origin:     strings.TrimSpace(query.Get("origin")),
		Backend:    strings.TrimSpace(query.Get("backend")),
		Limit:      limit,
		Cursor:     strings.TrimSpace(query.Get("cursor")),
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
