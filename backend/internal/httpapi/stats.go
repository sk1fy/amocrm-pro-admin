package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

func (h *api) getStats(w http.ResponseWriter, r *http.Request) {
	period := strings.TrimSpace(r.URL.Query().Get("period"))
	if period == "" {
		period = adapter.StatsPeriod7d
	}
	if !adapter.ValidStatsPeriod(period) {
		httpx.WriteError(w, r, httpx.InvalidArgument("period must be 24h, 7d, or 30d"))
		return
	}
	items := make([]observationDTO, 0)
	for _, backend := range h.registry.Backends() {
		stats, ok := adapter.AsStats(backend)
		source := backend.Descriptor().Code
		if !ok {
			items = append(items, observationFrom(adapter.UnknownObs[adapter.StatsSnapshot](source, time.Now().UTC(), adapter.ErrorCodeUnsupported, "backend does not declare stats"), nil))
			continue
		}
		obs, err := stats.GetStats(r.Context(), adminActor(r), period)
		if err != nil {
			items = append(items, unavailableObservation(source, err))
			continue
		}
		var data any
		if obs.Data != nil {
			data = toStatsSnapshotDTO(*obs.Data)
		}
		items = append(items, observationFrom(obs, data))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "period": period})
}

func (h *api) listStatsAccounts(w http.ResponseWriter, r *http.Request) {
	period := strings.TrimSpace(r.URL.Query().Get("period"))
	if period == "" {
		period = adapter.StatsPeriod7d
	}
	if !adapter.ValidStatsPeriod(period) {
		httpx.WriteError(w, r, httpx.InvalidArgument("period must be 24h, 7d, or 30d"))
		return
	}
	limit, err := parseLimitParam(r.URL.Query().Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	filter := adapter.StatsAccountFilter{
		Metric:  strings.TrimSpace(r.URL.Query().Get("metric")),
		Period:  period,
		Product: strings.TrimSpace(r.URL.Query().Get("product")),
		Limit:   limit,
		Cursor:  strings.TrimSpace(r.URL.Query().Get("cursor")),
	}
	if filter.Metric == "" {
		httpx.WriteError(w, r, httpx.InvalidArgument("metric is required"))
		return
	}
	items := []statsAccountDTO{}
	sources := []adapter.SourceStatus{}
	var next *string
	for _, backend := range h.registry.Backends() {
		stats, ok := adapter.AsStats(backend)
		source := backend.Descriptor().Code
		if !ok {
			sources = append(sources, adapter.SourceStatus{Backend: source, Status: adapter.SourceUnknown})
			continue
		}
		obs, listErr := stats.ListStatsAccounts(r.Context(), adminActor(r), filter)
		if listErr != nil {
			if errors.Is(listErr, adapter.ErrInvalidArgument) {
				writeAdapterError(w, r, listErr)
				return
			}
			sources = append(sources, adapter.SourceFromErr(source, time.Now().UTC(), listErr))
			continue
		}
		if obs.Data != nil {
			for _, item := range obs.Data.Items {
				items = append(items, toStatsAccountDTO(source, item))
			}
			if next == nil {
				next = obs.Data.NextCursor
			}
		}
		sources = append(sources, adapter.SourceFromErr(source, obs.ObservedAt, nil))
	}
	httpx.WriteJSON(w, http.StatusOK, sourcedListResponse{Items: items, NextCursor: next, Sources: sources})
}
