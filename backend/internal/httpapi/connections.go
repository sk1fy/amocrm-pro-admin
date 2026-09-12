package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/sync/errgroup"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

func (h *api) getConnection(w http.ResponseWriter, r *http.Request) {
	backendCode := chi.URLParam(r, "backend")
	id := chi.URLParam(r, "connection_id")
	backend, ok := h.registry.Adapter(backendCode)
	if !ok {
		httpx.WriteError(w, r, httpx.NotFound("backend not found"))
		return
	}
	actor := adminActor(r)
	ctx := r.Context()

	var (
		connObs       adapter.Observation[adapter.ConnectionDetail]
		connErr       error
		jobsObs       adapter.Observation[adapter.Page[adapter.Job]]
		jobsErr       error
		auditObs      adapter.Observation[adapter.Page[adapter.AuditEntry]]
		auditErr      error
		deliveriesObs adapter.Observation[[]adapter.Delivery]
		deliveriesErr error
	)
	var group errgroup.Group
	group.Go(func() error {
		connObs, connErr = backend.GetConnection(ctx, actor, id)
		return nil
	})
	group.Go(func() error {
		jobsObs, jobsErr = backend.ListConnectionJobs(ctx, actor, id, adapter.JobFilter{Limit: 10})
		return nil
	})
	group.Go(func() error {
		auditObs, auditErr = backend.ListConnectionAudit(ctx, actor, id, adapter.PageFilter{Limit: 10})
		return nil
	})
	group.Go(func() error {
		deliveriesObs, deliveriesErr = backend.ListConnectionDeliveries(ctx, actor, id, adapter.PageFilter{Limit: 10})
		return nil
	})
	_ = group.Wait()

	if errors.Is(connErr, adapter.ErrNotFound) {
		httpx.WriteError(w, r, httpx.NotFound("connection not found"))
		return
	}

	now := time.Now().UTC()
	source := backend.Descriptor().Code
	card := connectionCardDTO{Backend: source}
	if connErr != nil {
		unavail := unavailableObservation(source, connErr)
		card.Connection = unavail
		card.Authorization = unavail
		card.Webhook = unavail
		card.Grants = unavail
		card.Activity = unavail
	} else {
		data := connObs.Data
		detail := adapter.ConnectionDetail{}
		if data != nil {
			detail = *data
		}
		card.Connection = observationFrom(connObs, toConnectionDTO(detail.Connection))
		card.Authorization = observationFrom(connObs, toAuthorizationDTO(detail.Authorization))
		card.Webhook = observationFrom(connObs, toWebhookDTO(detail.Webhook))
		card.Grants = observationFrom(connObs, toGrantDTOs(detail.Grants))
		activity := activityDTO{Pilot: detail.Activity.Pilot.Canonical, PilotRaw: detail.Activity.Pilot.Raw}
		if deliveriesErr == nil && deliveriesObs.Data != nil {
			items := make([]deliveryDTO, 0, len(*deliveriesObs.Data))
			for _, item := range *deliveriesObs.Data {
				items = append(items, toDeliveryDTO(item))
			}
			card.Activity = observationFrom(deliveriesObs, map[string]any{"pilot": activity, "deliveries": items})
		} else {
			card.Activity = observationFrom(connObs, activity)
		}
	}
	if jobsErr != nil {
		card.RecentJobs = unavailableObservation(source, jobsErr)
	} else {
		items := []jobDTO{}
		if jobsObs.Data != nil {
			for _, item := range jobsObs.Data.Items {
				items = append(items, toJobDTO(item))
			}
		}
		card.RecentJobs = observationFrom(jobsObs, items)
	}
	if auditErr != nil {
		card.RecentAudit = unavailableObservation(source, auditErr)
	} else {
		items := []auditEntryDTO{}
		if auditObs.Data != nil {
			for _, item := range auditObs.Data.Items {
				items = append(items, toAuditDTOFromAdapter(item))
			}
		}
		card.RecentAudit = observationFrom(auditObs, items)
	}
	card.ActivitySync = observationDTO{
		Source: source, ObservedAt: now, Freshness: adapter.FreshnessUnknown,
		Error: &adapter.ObsError{Code: adapter.ErrorCodeUnsupported, Message: "Activity sync is connected in stage 3"},
	}
	httpx.WriteJSON(w, http.StatusOK, card)
}

func (h *api) listConnectionJobs(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	limit, err := parseLimitParam(r.URL.Query().Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	obs, listErr := backend.ListConnectionJobs(r.Context(), adminActor(r), id, adapter.JobFilter{
		Status: strings.TrimSpace(r.URL.Query().Get("status")),
		Type:   strings.TrimSpace(r.URL.Query().Get("type")),
		Limit:  limit,
		Cursor: strings.TrimSpace(r.URL.Query().Get("cursor")),
	})
	h.writeJobPage(w, r, backend.Descriptor().Code, obs, listErr)
}

func (h *api) listConnectionAudit(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	limit, err := parseLimitParam(r.URL.Query().Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	obs, listErr := backend.ListConnectionAudit(r.Context(), adminActor(r), id, adapter.PageFilter{
		Limit:  limit,
		Cursor: strings.TrimSpace(r.URL.Query().Get("cursor")),
	})
	if listErr != nil {
		if errors.Is(listErr, adapter.ErrNotFound) {
			writeAdapterError(w, r, listErr)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, sourcedListResponse{
			Items:   []auditEntryDTO{},
			Sources: []adapter.SourceStatus{adapter.SourceFromErr(backend.Descriptor().Code, time.Now().UTC(), listErr)},
		})
		return
	}
	items := []auditEntryDTO{}
	var next *string
	if obs.Data != nil {
		for _, item := range obs.Data.Items {
			items = append(items, toAuditDTOFromAdapter(item))
		}
		next = obs.Data.NextCursor
	}
	httpx.WriteJSON(w, http.StatusOK, sourcedListResponse{
		Items: items, NextCursor: next,
		Sources: []adapter.SourceStatus{adapter.SourceFromErr(backend.Descriptor().Code, obs.ObservedAt, nil)},
	})
}

func (h *api) lookupBackend(w http.ResponseWriter, r *http.Request) (adapter.Backend, string, bool) {
	code := chi.URLParam(r, "backend")
	id := chi.URLParam(r, "connection_id")
	if id == "" {
		id = chi.URLParam(r, "integration_id")
	}
	if id == "" {
		id = chi.URLParam(r, "job_id")
	}
	backend, ok := h.registry.Adapter(code)
	if !ok {
		httpx.WriteError(w, r, httpx.NotFound("backend not found"))
		return nil, "", false
	}
	return backend, id, true
}

func (h *api) writeJobPage(w http.ResponseWriter, r *http.Request, code string, obs adapter.Observation[adapter.Page[adapter.Job]], err error) {
	if err != nil {
		if errors.Is(err, adapter.ErrNotFound) || errors.Is(err, adapter.ErrInvalidArgument) {
			writeAdapterError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, sourcedListResponse{
			Items:   []jobDTO{},
			Sources: []adapter.SourceStatus{adapter.SourceFromErr(code, time.Now().UTC(), err)},
		})
		return
	}
	items := []jobDTO{}
	var next *string
	var total *int
	if obs.Data != nil {
		for _, item := range obs.Data.Items {
			items = append(items, toJobDTO(item))
		}
		next = obs.Data.NextCursor
		total = obs.Data.Total
	}
	httpx.WriteJSON(w, http.StatusOK, sourcedListResponse{
		Items: items, NextCursor: next, Total: total,
		Sources: []adapter.SourceStatus{adapter.SourceFromErr(code, obs.ObservedAt, nil)},
	})
}
