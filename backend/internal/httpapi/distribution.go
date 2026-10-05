package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

func (h *api) getDistribution(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	d, ok := backend.(adapter.DistributionBackend)
	if !ok || !backend.Capabilities().DistributionRead {
		httpx.WriteJSON(w, http.StatusOK, adapter.UnknownObs[adapter.DistributionSummary](backend.Descriptor().Code, time.Now().UTC(), adapter.ErrorCodeUnsupported, "Источник не поддерживает диагностику распределения"))
		return
	}
	obs, err := d.GetDistribution(r.Context(), adminActor(r), id)
	if err != nil {
		writeDistributionError(w, r, backend, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, obs)
}
func (h *api) getDistributionTrace(w http.ResponseWriter, r *http.Request) {
	backend, id, ok := h.lookupBackend(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	limit, err := parseLimitParam(q.Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	reference := q.Get("reference")
	if reference != "" {
		if _, err := uuid.Parse(reference); err != nil {
			httpx.WriteError(w, r, httpx.InvalidArgument("ID события, операции или запроса должен быть UUID"))
			return
		}
	}
	d, ok := backend.(adapter.DistributionBackend)
	if !ok || !backend.Capabilities().DistributionRead {
		httpx.WriteJSON(w, http.StatusOK, adapter.UnknownObs[adapter.DistributionTrace](backend.Descriptor().Code, time.Now().UTC(), adapter.ErrorCodeUnsupported, "Источник не поддерживает цепочку распределения"))
		return
	}
	obs, err := d.GetDistributionTrace(r.Context(), adminActor(r), id, adapter.DistributionFilter{Reference: reference, PageFilter: adapter.PageFilter{Limit: limit, Cursor: q.Get("cursor")}})
	if err != nil {
		writeDistributionError(w, r, backend, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, obs)
}
func writeDistributionError(w http.ResponseWriter, r *http.Request, b adapter.Backend, err error) {
	if errors.Is(err, adapter.ErrNotFound) || errors.Is(err, adapter.ErrInvalidArgument) {
		writeAdapterError(w, r, err)
		return
	}
	obs := unavailableObservation(b.Descriptor().Code, err)
	if obs.Error != nil {
		obs.Error.Message = "Источник распределения недоступен. Проверьте подключение Core и повторите чтение."
		if errors.Is(err, adapter.ErrTimeout) {
			obs.Error.Message = "Источник распределения не ответил в срок. Повторите чтение после проверки Core."
		}
	}
	httpx.WriteJSON(w, http.StatusOK, obs)
}
