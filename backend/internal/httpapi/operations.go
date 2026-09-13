package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/accounts"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

func (h *api) listJobs(w http.ResponseWriter, r *http.Request) {
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
	backends, ok := h.backendsFor(w, r, func(c adapter.Capabilities) bool { return c.Jobs })
	if !ok {
		return
	}
	actor := adminActor(r)
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	jobType := strings.TrimSpace(r.URL.Query().Get("type"))
	var since *time.Time
	if raw := strings.TrimSpace(r.URL.Query().Get("since")); raw != "" {
		parsed, parseErr := time.Parse(time.RFC3339, raw)
		if parseErr != nil {
			httpx.WriteError(w, r, httpx.InvalidArgument("invalid since"))
			return
		}
		parsed = parsed.UTC()
		if time.Since(parsed) > 7*24*time.Hour {
			parsed = time.Now().UTC().Add(-(7*24*time.Hour - time.Minute))
		}
		since = &parsed
	}
	gathered := adapter.Gather(r.Context(), backends, func(ctx context.Context, backend adapter.Backend) (adapter.Observation[adapter.Page[adapter.Job]], error) {
		return backend.ListJobs(ctx, actor, adapter.JobFilter{
			Status: status, Type: jobType, Since: since, Limit: limit, Cursor: cursors[backend.Descriptor().Code],
		})
	})
	if gathered.Invalid != nil {
		httpx.WriteError(w, r, httpx.InvalidArgument("invalid cursor"))
		return
	}
	items := make([]jobDTO, 0)
	next := map[string]string{}
	for _, obs := range gathered.Items {
		if obs.Data == nil {
			continue
		}
		if obs.Data.NextCursor != nil && *obs.Data.NextCursor != "" {
			next[obs.Source] = *obs.Data.NextCursor
		}
		for _, item := range obs.Data.Items {
			items = append(items, toJobDTO(item))
		}
	}
	httpx.WriteJSON(w, http.StatusOK, sourcedListResponse{
		Items: items, NextCursor: accounts.EncodeCursors(next), Sources: gathered.Sources,
	})
}

func (h *api) getJob(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	obs, err := backend.GetJob(r.Context(), adminActor(r), id)
	if err != nil {
		if errors.Is(err, adapter.ErrNotFound) || errors.Is(err, adapter.ErrInvalidArgument) {
			writeAdapterError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, unavailableObservation(backend.Descriptor().Code, err))
		return
	}
	data := jobDetailDTO{Attempts: []jobAttemptDTO{}}
	if obs.Data != nil {
		attempts := make([]jobAttemptDTO, 0, len(obs.Data.Attempts))
		for _, item := range obs.Data.Attempts {
			attempts = append(attempts, toJobAttemptDTO(item))
		}
		data = jobDetailDTO{Job: toJobDTO(obs.Data.Job), Attempts: attempts}
	}
	httpx.WriteJSON(w, http.StatusOK, observationFrom(obs, data))
}

func (h *api) listBackends(w http.ResponseWriter, r *http.Request) {
	actor := adminActor(r)
	items := make([]observationDTO, 0)
	for _, backend := range h.registry.Backends() {
		obs, err := backend.Health(r.Context(), actor)
		if err != nil {
			items = append(items, unavailableObservation(backend.Descriptor().Code, err))
			continue
		}
		var data any
		if obs.Data != nil {
			data = map[string]any{
				"backend":          obs.Data.Backend,
				"revision":         obs.Data.Revision,
				"contract_version": obs.Data.ContractVersion,
				"capabilities":     obs.Data.Capabilities,
				"components":       obs.Data.Components,
			}
		}
		items = append(items, observationFrom(obs, data))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"items":         items,
		"observability": observabilityDTO{GrafanaBaseURL: h.grafanaBaseURL, LokiBaseURL: h.lokiBaseURL},
	})
}

func (h *api) catalog(w http.ResponseWriter, r *http.Request) {
	entries := h.registry.Entries()
	backends := make([]catalogBackendDTO, 0, len(entries))
	for _, entry := range entries {
		products := make([]catalogProductDTO, 0, len(entry.Products))
		for _, product := range entry.Products {
			products = append(products, catalogProductDTO{Code: product.Code, DisplayName: product.DisplayName})
		}
		backends = append(backends, catalogBackendDTO{
			Code: entry.Code, Kind: entry.Kind, DisplayName: entry.DisplayName, Products: products,
		})
	}
	products := make([]catalogProductDTO, 0)
	for _, product := range h.registry.Products() {
		products = append(products, catalogProductDTO{Code: product.Code, DisplayName: product.DisplayName})
	}
	httpx.WriteJSON(w, http.StatusOK, catalogResponse{Backends: backends, Products: products})
}
