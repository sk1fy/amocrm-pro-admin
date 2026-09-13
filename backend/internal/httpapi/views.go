package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/views"
)

type createViewRequest struct {
	Section string          `json:"section"`
	Name    string          `json:"name"`
	Params  json.RawMessage `json:"params"`
	Columns json.RawMessage `json:"columns"`
	Shared  bool            `json:"shared"`
}

type patchViewRequest struct {
	Name    *string         `json:"name"`
	Params  json.RawMessage `json:"params"`
	Columns json.RawMessage `json:"columns"`
}

type viewDTO struct {
	OwnerEmployeeID *string         `json:"owner_employee_id"`
	ID              string          `json:"id"`
	Section         string          `json:"section"`
	Name            string          `json:"name"`
	Params          json.RawMessage `json:"params"`
	Columns         json.RawMessage `json:"columns"`
	CreatedAt       string          `json:"created_at"`
	UpdatedAt       string          `json:"updated_at"`
	Shared          bool            `json:"shared"`
}

func (h *api) listViews(w http.ResponseWriter, r *http.Request) {
	if h.views == nil {
		httpx.WriteError(w, r, httpx.BackendUnavailable("views unavailable"))
		return
	}
	section := strings.TrimSpace(r.URL.Query().Get("section"))
	if !views.ValidSection(section) {
		httpx.WriteError(w, r, httpx.InvalidArgument("section must be accounts, operations, or stats"))
		return
	}
	emp, _ := rbac.EmployeeFromContext(r.Context())
	items, err := h.views.List(r.Context(), emp.ID, section)
	if err != nil {
		if errors.Is(err, views.ErrInvalid) {
			httpx.WriteError(w, r, httpx.InvalidArgument("invalid view"))
			return
		}
		httpx.WriteError(w, r, httpx.Internal())
		return
	}
	dtos := make([]viewDTO, 0, len(items))
	for _, item := range items {
		dtos = append(dtos, toViewDTO(item))
	}
	total := len(dtos)
	httpx.WriteJSON(w, http.StatusOK, listResponse{Items: dtos, Total: &total})
}

func (h *api) createView(w http.ResponseWriter, r *http.Request) {
	if h.views == nil {
		httpx.WriteError(w, r, httpx.BackendUnavailable("views unavailable"))
		return
	}
	var body createViewRequest
	if err := decodeJSON(r, &body); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	emp, _ := rbac.EmployeeFromContext(r.Context())
	var owner *uuid.UUID
	if !body.Shared {
		id := emp.ID
		owner = &id
	}
	item, err := h.views.Create(r.Context(), views.CreateInput{
		OwnerEmployeeID: owner, Section: body.Section, Name: body.Name, Params: body.Params, Columns: body.Columns,
	})
	if err != nil {
		writeViewError(w, r, err)
		return
	}
	actor := actorFrom(r)
	_ = h.audit.Record(r.Context(), audit.Event{
		EmployeeID: actor.id, ActorEmail: actor.email, Action: "view.create",
		ObjectType: "view", ObjectRef: "view:" + item.ID.String(),
		RequestID: httpx.RequestIDFromContext(r.Context()), IP: h.clientIP(r),
		Metadata: map[string]any{"section": item.Section, "shared": body.Shared},
	})
	httpx.WriteJSON(w, http.StatusCreated, toViewDTO(item))
}

func (h *api) patchView(w http.ResponseWriter, r *http.Request) {
	h.mutateView(w, r, func(id uuid.UUID, emp rbac.Employee) error {
		var body patchViewRequest
		if err := decodeJSON(r, &body); err != nil {
			return err
		}
		_, err := h.views.Update(r.Context(), id, views.UpdateInput{Name: body.Name, Params: body.Params, Columns: body.Columns})
		return err
	}, "view.update")
}

func (h *api) deleteView(w http.ResponseWriter, r *http.Request) {
	h.mutateView(w, r, func(id uuid.UUID, emp rbac.Employee) error {
		return h.views.Delete(r.Context(), id)
	}, "view.delete")
}

func (h *api) mutateView(w http.ResponseWriter, r *http.Request, apply func(uuid.UUID, rbac.Employee) error, action string) {
	if h.views == nil {
		httpx.WriteError(w, r, httpx.BackendUnavailable("views unavailable"))
		return
	}
	id, err := parseID(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	emp, _ := rbac.EmployeeFromContext(r.Context())
	current, err := h.views.Get(r.Context(), id)
	if err != nil {
		writeViewError(w, r, err)
		return
	}
	if !views.CanWrite(current, emp.ID, emp.Role) {
		httpx.WriteError(w, r, httpx.Forbidden("insufficient permissions"))
		return
	}
	if err := apply(id, emp); err != nil {
		writeViewError(w, r, err)
		return
	}
	actor := actorFrom(r)
	_ = h.audit.Record(r.Context(), audit.Event{
		EmployeeID: actor.id, ActorEmail: actor.email, Action: action,
		ObjectType: "view", ObjectRef: "view:" + id.String(),
		RequestID: httpx.RequestIDFromContext(r.Context()), IP: h.clientIP(r),
	})
	if action == "view.delete" {
		httpx.WriteJSON(w, http.StatusOK, okResponse{OK: true})
		return
	}
	updated, err := h.views.Get(r.Context(), id)
	if err != nil {
		writeViewError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toViewDTO(updated))
}

func writeViewError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, views.ErrNotFound):
		httpx.WriteError(w, r, httpx.NotFound("view not found"))
	case errors.Is(err, views.ErrConflict):
		httpx.WriteError(w, r, httpx.Conflict("view already exists"))
	case errors.Is(err, views.ErrInvalid):
		httpx.WriteError(w, r, httpx.InvalidArgument("invalid view"))
	default:
		var apiErr httpx.Error
		if errors.As(err, &apiErr) {
			httpx.WriteError(w, r, apiErr)
			return
		}
		httpx.WriteError(w, r, httpx.Internal())
	}
}

func toViewDTO(item views.View) viewDTO {
	var owner *string
	if item.OwnerEmployeeID != nil {
		value := item.OwnerEmployeeID.String()
		owner = &value
	}
	params := item.Params
	if len(params) == 0 {
		params = json.RawMessage(`{}`)
	}
	columns := item.Columns
	if len(columns) == 0 {
		columns = json.RawMessage(`[]`)
	}
	return viewDTO{
		ID: item.ID.String(), OwnerEmployeeID: owner, Section: item.Section, Name: item.Name,
		Params: params, Columns: columns, CreatedAt: item.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: item.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"), Shared: item.OwnerEmployeeID == nil,
	}
}
