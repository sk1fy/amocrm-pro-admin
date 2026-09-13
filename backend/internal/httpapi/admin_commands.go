package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/operations"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
)

func (h *api) submitCommand(w http.ResponseWriter, r *http.Request) {
	if h.operations == nil {
		httpx.WriteError(w, r, httpx.BackendUnavailable("operations unavailable"))
		return
	}
	targetType, targetID, command := "installation", chi.URLParam(r, "connection_id"), chi.URLParam(r, "command")
	if strings.HasPrefix(r.URL.Path, "/api/v1/integrations/") {
		targetType = "integration"
		targetID = chi.URLParam(r, "integration_id")
		if targetID == "" {
			targetID = "new"
			command = "create"
		}
	}
	if id := chi.URLParam(r, "job_id"); id != "" {
		targetType = "job"
		targetID = id
		command = "retry"
	}
	if id := chi.URLParam(r, "delivery_id"); id != "" {
		targetType = "delivery"
		targetID = id
		command = "retry"
	}
	principal, _ := auth.PrincipalFromContext(r.Context())
	// Authorize before parsing a body or touching a backend; service repeats the DB
	// check immediately before dispatch as well.
	employee, err := h.employees.Get(r.Context(), principal.EmployeeID)
	permission := operations.Permission(targetType, command)
	if err != nil || employee.Status != auth.StatusActive || !rbac.Allows(employee.Role, permission) {
		httpx.WriteError(w, r, httpx.Forbidden("insufficient permissions"))
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil || len(raw) > maxBodyBytes {
		httpx.WriteError(w, r, httpx.InvalidArgument("invalid request body"))
		return
	}
	var payload map[string]json.RawMessage
	if json.Unmarshal(raw, &payload) != nil || payload == nil {
		httpx.WriteError(w, r, httpx.InvalidArgument("request must be a JSON object"))
		return
	}
	if targetType == "delivery" {
		value, _ := json.Marshal(chi.URLParam(r, "connection_id"))
		payload["installation_id"] = value
	}
	raw, err = json.Marshal(payload)
	if err != nil {
		httpx.WriteError(w, r, httpx.InvalidArgument("invalid body"))
		return
	}
	operation, err := h.operations.Execute(r.Context(), operations.Submit{EmployeeID: principal.EmployeeID, Backend: chi.URLParam(r, "backend"), Key: r.Header.Get("Idempotency-Key"), Request: adapter.CommandRequest{TargetType: targetType, TargetID: targetID, Command: command, Payload: raw}})
	if err != nil {
		writeOperationError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"operation": operation})
}
func (h *api) getAdminOperation(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if h.operations == nil {
		httpx.WriteError(w, r, httpx.NotFound("operation not found"))
		return
	}
	operation, err := h.operations.Get(r.Context(), id)
	if err != nil {
		writeOperationError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"operation": operation})
}
func (h *api) listAdminOperations(w http.ResponseWriter, r *http.Request) {
	limit, err := parseLimitParam(r.URL.Query().Get("limit"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if h.operations == nil {
		httpx.WriteJSON(w, http.StatusOK, listResponse{Items: []operations.Operation{}})
		return
	}
	q := r.URL.Query()
	items, next, err := h.operations.List(r.Context(), operations.ListFilter{Backend: q.Get("backend"), TargetType: q.Get("target_type"), TargetID: q.Get("target_id"), Command: q.Get("command"), State: q.Get("state"), Key: q.Get("request_key"), Cursor: q.Get("cursor"), Limit: limit})
	if err != nil {
		writeOperationError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, listResponse{Items: items, NextCursor: next})
}
func writeOperationError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, adapter.ErrUnsupported):
		httpx.WriteError(w, r, httpx.Conflict("backend does not support commands"))
	case errors.Is(err, operations.ErrForbidden):
		httpx.WriteError(w, r, httpx.Forbidden("insufficient permissions"))
	case errors.Is(err, operations.ErrInvalid):
		httpx.WriteError(w, r, httpx.InvalidArgument("invalid command or idempotency key"))
	case errors.Is(err, operations.ErrConflict):
		httpx.WriteError(w, r, httpx.Conflict("another command is running or the key has a different payload"))
	case errors.Is(err, operations.ErrNotFound):
		httpx.WriteError(w, r, httpx.NotFound("operation or backend not found"))
	default:
		writeAdapterError(w, r, err)
	}
}
