package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/sk1fy/amocrm-pro-admin/internal/accounts"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

func (h *api) listIntegrations(w http.ResponseWriter, r *http.Request) {
	limit, err := parseLimitParam(r.URL.Query().Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	cursors, err := accounts.DecodeCursors(r.URL.Query().Get("cursor"))
	if err != nil {
		httpx.WriteError(w, r, httpx.InvalidArgument("invalid cursor"))
		return
	}
	backends, ok := h.backendsFor(w, r, func(c adapter.Capabilities) bool { return c.Integrations })
	if !ok {
		return
	}
	actor := adminActor(r)
	gathered := adapter.Gather(r.Context(), backends, func(ctx context.Context, backend adapter.Backend) (adapter.Observation[adapter.Page[adapter.Integration]], error) {
		return backend.ListIntegrations(ctx, actor, adapter.PageFilter{
			Limit:  limit,
			Cursor: cursors[backend.Descriptor().Code],
		})
	})
	if gathered.Invalid != nil {
		httpx.WriteError(w, r, httpx.InvalidArgument("invalid cursor"))
		return
	}
	items := make([]integrationDTO, 0)
	next := map[string]string{}
	for _, obs := range gathered.Items {
		if obs.Data == nil {
			continue
		}
		if obs.Data.NextCursor != nil && *obs.Data.NextCursor != "" {
			next[obs.Source] = *obs.Data.NextCursor
		}
		for _, item := range obs.Data.Items {
			items = append(items, toIntegrationDTO(obs.Source, item))
		}
	}
	httpx.WriteJSON(w, http.StatusOK, sourcedListResponse{
		Items: items, NextCursor: accounts.EncodeCursors(next), Sources: gathered.Sources,
	})
}

func (h *api) getIntegration(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	obs, err := backend.GetIntegration(r.Context(), adminActor(r), id)
	if err != nil {
		if errors.Is(err, adapter.ErrNotFound) || errors.Is(err, adapter.ErrInvalidArgument) {
			writeAdapterError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, unavailableObservation(backend.Descriptor().Code, err))
		return
	}
	data := integrationDTO{}
	if obs.Data != nil {
		data = toIntegrationDTO(backend.Descriptor().Code, *obs.Data)
	}
	httpx.WriteJSON(w, http.StatusOK, observationFrom(obs, data))
}

func (h *api) backendsFor(w http.ResponseWriter, r *http.Request, allow func(adapter.Capabilities) bool) ([]adapter.Backend, bool) {
	code := strings.TrimSpace(r.URL.Query().Get("backend"))
	if code == "" {
		return adapter.Capable(h.registry.Backends(), allow), true
	}
	backend, ok := h.registry.Adapter(code)
	if !ok {
		httpx.WriteError(w, r, httpx.NotFound("backend not found"))
		return nil, false
	}
	return []adapter.Backend{backend}, true
}
