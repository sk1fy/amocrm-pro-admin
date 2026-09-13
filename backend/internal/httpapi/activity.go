package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

func (h *api) getActivitySettings(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	writeSettingsObservation(w, r, backend, func(settings adapter.SettingsBackend, actor adapter.Actor, _ string) (adapter.Observation[adapter.ActivitySettings], error) {
		return settings.GetActivitySettings(r.Context(), actor, id)
	}, func(item adapter.ActivitySettings) any { return toActivitySettingsDTO(item) })
}

func (h *api) getActivityStatus(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	writeSettingsObservation(w, r, backend, func(settings adapter.SettingsBackend, actor adapter.Actor, _ string) (adapter.Observation[adapter.ActivitySyncStatus], error) {
		return settings.GetActivitySyncStatus(r.Context(), actor, id)
	}, func(item adapter.ActivitySyncStatus) any { return toActivitySyncDTO(item) })
}

func (h *api) listActivityPanels(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	writeSettingsObservation(w, r, backend, func(settings adapter.SettingsBackend, actor adapter.Actor, _ string) (adapter.Observation[[]adapter.ActivityPanel], error) {
		return settings.ListActivityPanels(r.Context(), actor, id)
	}, func(items []adapter.ActivityPanel) any {
		out := make([]activityPanelDTO, 0, len(items))
		for _, item := range items {
			out = append(out, toActivityPanelDTO(item))
		}
		return out
	})
}

func (h *api) getActivityPanel(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	panelID := chi.URLParam(r, "panel_id")
	writeSettingsObservation(w, r, backend, func(settings adapter.SettingsBackend, actor adapter.Actor, _ string) (adapter.Observation[adapter.ActivityPanel], error) {
		return settings.GetActivityPanel(r.Context(), actor, id, panelID)
	}, func(item adapter.ActivityPanel) any { return toActivityPanelDTO(item) })
}

func (h *api) listActivityEmployees(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	writeSettingsObservation(w, r, backend, func(settings adapter.SettingsBackend, actor adapter.Actor, _ string) (adapter.Observation[[]adapter.ActivityEmployee], error) {
		return settings.ListActivityEmployees(r.Context(), actor, id)
	}, func(items []adapter.ActivityEmployee) any {
		out := make([]activityEmployeeDTO, 0, len(items))
		for _, item := range items {
			out = append(out, toActivityEmployeeDTO(item))
		}
		return out
	})
}

func (h *api) listLeadStatusRules(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	writeSettingsObservation(w, r, backend, func(settings adapter.SettingsBackend, actor adapter.Actor, _ string) (adapter.Observation[[]adapter.LeadStatusRule], error) {
		return settings.ListLeadStatusRules(r.Context(), actor, id)
	}, func(items []adapter.LeadStatusRule) any {
		out := make([]leadStatusRuleDTO, 0, len(items))
		for _, item := range items {
			out = append(out, toLeadStatusRuleDTO(item))
		}
		return out
	})
}

func (h *api) listLeadStatusRuns(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	limit, err := parseLimitParam(r.URL.Query().Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	cursor := r.URL.Query().Get("cursor")
	writeSettingsObservation(w, r, backend, func(settings adapter.SettingsBackend, actor adapter.Actor, _ string) (adapter.Observation[adapter.Page[adapter.LeadStatusRun]], error) {
		return settings.ListLeadStatusRuns(r.Context(), actor, id, adapter.PageFilter{Limit: limit, Cursor: cursor})
	}, func(page adapter.Page[adapter.LeadStatusRun]) any {
		items := make([]leadStatusRunDTO, 0, len(page.Items))
		for _, item := range page.Items {
			items = append(items, toLeadStatusRunDTO(item))
		}
		return map[string]any{"items": items, "next_cursor": page.NextCursor, "total": page.Total}
	})
}

func writeSettingsObservation[T any](w http.ResponseWriter, r *http.Request, backend adapter.Backend, load func(adapter.SettingsBackend, adapter.Actor, string) (adapter.Observation[T], error), mapData func(T) any) {
	source := backend.Descriptor().Code
	id := chi.URLParam(r, "connection_id")
	settings, ok := adapter.AsSettings(backend)
	if !ok {
		httpx.WriteJSON(w, http.StatusOK, observationFrom(adapter.UnknownObs[T](source, time.Now().UTC(), adapter.ErrorCodeUnsupported, "backend does not declare settings"), nil))
		return
	}
	obs, err := load(settings, adminActor(r), id)
	if err != nil {
		if errors.Is(err, adapter.ErrNotFound) || errors.Is(err, adapter.ErrInvalidArgument) {
			writeAdapterError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, unavailableObservation(source, err))
		return
	}
	var data any
	if obs.Data != nil {
		data = mapData(*obs.Data)
	}
	httpx.WriteJSON(w, http.StatusOK, observationFrom(obs, data))
}
