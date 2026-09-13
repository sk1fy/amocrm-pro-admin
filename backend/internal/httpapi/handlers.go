package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
)

const (
	minPasswordLength   = 8
	loginFailureMessage = "invalid email or password"
	defaultAuditLimit   = 25
)

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type createEmployeeRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Password string `json:"password"`
}

type patchEmployeeRequest struct {
	Name   *string `json:"name"`
	Role   *string `json:"role"`
	Status *string `json:"status"`
}

type employeeDTO struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type meDTO struct {
	ID          string   `json:"id"`
	Email       string   `json:"email"`
	Name        string   `json:"name"`
	Role        string   `json:"role"`
	Permissions []string `json:"permissions"`
}

type sessionDTO struct {
	ID           string     `json:"id"`
	CreatedAt    time.Time  `json:"created_at"`
	LastSeenAt   time.Time  `json:"last_seen_at"`
	ExpiresAt    time.Time  `json:"expires_at"`
	RevokedAt    *time.Time `json:"revoked_at"`
	RevokeReason *string    `json:"revoke_reason"`
	IP           *string    `json:"ip"`
	UserAgent    *string    `json:"user_agent"`
}

type auditDTO struct {
	ID         int64           `json:"id"`
	EmployeeID *string         `json:"employee_id"`
	ActorEmail *string         `json:"actor_email"`
	Action     string          `json:"action"`
	ObjectType *string         `json:"object_type"`
	ObjectRef  *string         `json:"object_ref"`
	Outcome    string          `json:"outcome"`
	RequestID  *string         `json:"request_id"`
	IP         *string         `json:"ip"`
	Metadata   json.RawMessage `json:"metadata"`
	CreatedAt  time.Time       `json:"created_at"`
}

type listResponse struct {
	Items      any     `json:"items"`
	NextCursor *string `json:"next_cursor"`
	Total      *int    `json:"total"`
}

type okResponse struct {
	OK bool `json:"ok"`
}

func (h *api) clientIP(r *http.Request) string {
	return auth.ClientIPFrom(r, h.trustProxy)
}

func (h *api) login(w http.ResponseWriter, r *http.Request) {
	var body loginRequest
	if err := decodeJSON(r, &body); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	email := auth.NormalizeEmail(body.Email)
	ip := h.clientIP(r)
	if !h.limiter.Allow(ip, email) {
		httpx.WriteError(w, r, httpx.RateLimited("too many attempts"))
		return
	}
	token, account, err := h.sessions.Login(r.Context(), email, body.Password, ip, r.UserAgent())
	if err != nil {
		_ = h.audit.Record(r.Context(), audit.Event{
			ActorEmail: email,
			Action:     audit.ActionLoginFailed,
			Outcome:    audit.OutcomeDenied,
			RequestID:  httpx.RequestIDFromContext(r.Context()),
			IP:         ip,
		})
		httpx.WriteError(w, r, httpx.Unauthenticated(loginFailureMessage))
		return
	}
	_ = h.audit.Record(r.Context(), audit.Event{
		EmployeeID: &account.ID,
		ActorEmail: account.Email,
		Action:     audit.ActionLogin,
		ObjectType: "employee",
		ObjectRef:  "employee:" + account.ID.String(),
		RequestID:  httpx.RequestIDFromContext(r.Context()),
		IP:         ip,
	})
	h.sessions.SetCookie(w, token)
	httpx.WriteJSON(w, http.StatusOK, toMeDTO(account.ID, account.Email, account.Name, account.Role))
}

func (h *api) logout(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	if err := h.sessions.Revoke(r.Context(), principal.SessionID, auth.ReasonLogout); err != nil && !errors.Is(err, auth.ErrNotFound) {
		httpx.WriteError(w, r, httpx.Internal())
		return
	}
	_ = h.audit.Record(r.Context(), audit.Event{
		EmployeeID: &principal.EmployeeID,
		ActorEmail: principal.Account.Email,
		Action:     audit.ActionLogout,
		ObjectType: "session",
		ObjectRef:  "session:" + principal.SessionID.String(),
		RequestID:  httpx.RequestIDFromContext(r.Context()),
		IP:         h.clientIP(r),
	})
	h.sessions.ClearCookie(w)
	httpx.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

func (h *api) me(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	emp, err := h.employees.Get(r.Context(), principal.EmployeeID)
	if err != nil || emp.Status != auth.StatusActive {
		httpx.WriteError(w, r, httpx.Unauthenticated("authentication required"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toMeDTO(emp.ID, emp.Email, emp.Name, emp.Role))
}

func (h *api) listOwnSessions(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	items, err := h.sessions.ListOwn(r.Context(), principal.EmployeeID)
	if err != nil {
		httpx.WriteError(w, r, httpx.Internal())
		return
	}
	dtos := make([]sessionDTO, 0, len(items))
	for _, item := range items {
		dtos = append(dtos, toSessionDTO(item))
	}
	total := len(dtos)
	httpx.WriteJSON(w, http.StatusOK, listResponse{Items: dtos, Total: &total})
}

func (h *api) revokeOwnSession(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	id, err := parseID(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := h.sessions.RevokeOwned(r.Context(), id, principal.EmployeeID, auth.ReasonLogout); err != nil {
		if errors.Is(err, auth.ErrNotFound) {
			httpx.WriteError(w, r, httpx.NotFound("session not found"))
			return
		}
		httpx.WriteError(w, r, httpx.Internal())
		return
	}
	_ = h.audit.Record(r.Context(), audit.Event{
		EmployeeID: &principal.EmployeeID,
		ActorEmail: principal.Account.Email,
		Action:     audit.ActionSessionRevoke,
		ObjectType: "session",
		ObjectRef:  "session:" + id.String(),
		RequestID:  httpx.RequestIDFromContext(r.Context()),
		IP:         h.clientIP(r),
	})
	httpx.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

func (h *api) listEmployees(w http.ResponseWriter, r *http.Request) {
	items, err := h.employees.List(r.Context())
	if err != nil {
		httpx.WriteError(w, r, httpx.Internal())
		return
	}
	dtos := make([]employeeDTO, 0, len(items))
	for _, item := range items {
		dtos = append(dtos, toEmployeeDTO(item))
	}
	total := len(dtos)
	httpx.WriteJSON(w, http.StatusOK, listResponse{Items: dtos, Total: &total})
}

func (h *api) createEmployee(w http.ResponseWriter, r *http.Request) {
	var body createEmployeeRequest
	if err := decodeJSON(r, &body); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	email := auth.NormalizeEmail(body.Email)
	name := strings.TrimSpace(body.Name)
	if email == "" || name == "" {
		httpx.WriteError(w, r, httpx.InvalidArgument("email and name are required"))
		return
	}
	if !rbac.ValidRole(body.Role) {
		httpx.WriteError(w, r, httpx.InvalidArgument("role must be viewer, operator, or admin"))
		return
	}
	if utf8.RuneCountInString(body.Password) < minPasswordLength {
		httpx.WriteError(w, r, httpx.InvalidArgument("password must be at least 8 characters"))
		return
	}
	hash, err := auth.Hash(body.Password)
	if err != nil {
		httpx.WriteError(w, r, httpx.Internal())
		return
	}
	emp, err := h.employees.Create(r.Context(), employees.CreateInput{
		Email: email, Name: name, Role: body.Role, PasswordHash: hash,
	})
	if err != nil {
		if errors.Is(err, employees.ErrConflict) {
			httpx.WriteError(w, r, httpx.Conflict("employee already exists"))
			return
		}
		httpx.WriteError(w, r, httpx.Internal())
		return
	}
	actor := actorFrom(r)
	_ = h.audit.Record(r.Context(), audit.Event{
		EmployeeID: actor.id,
		ActorEmail: actor.email,
		Action:     audit.ActionEmployeeCreate,
		ObjectType: "employee",
		ObjectRef:  "employee:" + emp.ID.String(),
		RequestID:  httpx.RequestIDFromContext(r.Context()),
		IP:         h.clientIP(r),
		Metadata:   map[string]any{"email": emp.Email, "role": emp.Role},
	})
	httpx.WriteJSON(w, http.StatusCreated, toEmployeeDTO(emp))
}

func (h *api) patchEmployee(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var body patchEmployeeRequest
	if err := decodeJSON(r, &body); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if body.Name == nil && body.Role == nil && body.Status == nil {
		httpx.WriteError(w, r, httpx.InvalidArgument("at least one field is required"))
		return
	}
	if body.Name != nil && strings.TrimSpace(*body.Name) == "" {
		httpx.WriteError(w, r, httpx.InvalidArgument("name must not be blank"))
		return
	}
	if body.Role != nil && !rbac.ValidRole(*body.Role) {
		httpx.WriteError(w, r, httpx.InvalidArgument("role must be viewer, operator, or admin"))
		return
	}
	if body.Status != nil && *body.Status != auth.StatusActive && *body.Status != auth.StatusDisabled {
		httpx.WriteError(w, r, httpx.InvalidArgument("status must be active or disabled"))
		return
	}
	before, err := h.employees.GetRecord(r.Context(), id)
	if err != nil {
		if errors.Is(err, employees.ErrNotFound) {
			httpx.WriteError(w, r, httpx.NotFound("employee not found"))
			return
		}
		httpx.WriteError(w, r, httpx.Internal())
		return
	}
	emp, roleChanged, statusChanged, err := h.employees.Update(r.Context(), id, employees.UpdateInput{
		Name: body.Name, Role: body.Role, Status: body.Status,
	})
	if err != nil {
		if errors.Is(err, employees.ErrNotFound) {
			httpx.WriteError(w, r, httpx.NotFound("employee not found"))
			return
		}
		httpx.WriteError(w, r, httpx.Internal())
		return
	}
	if emp.Status == auth.StatusDisabled && statusChanged {
		if err := h.sessions.RevokeAll(r.Context(), emp.ID, auth.ReasonDisabled); err != nil {
			httpx.WriteError(w, r, httpx.Internal())
			return
		}
	} else if roleChanged {
		if err := h.sessions.RevokeAll(r.Context(), emp.ID, auth.ReasonRoleChange); err != nil {
			httpx.WriteError(w, r, httpx.Internal())
			return
		}
	}
	action := audit.ActionEmployeeUpdate
	if statusChanged && emp.Status == auth.StatusDisabled {
		action = audit.ActionEmployeeDisable
	}
	changed := make([]string, 0, 3)
	from := map[string]any{}
	to := map[string]any{}
	if body.Name != nil && before.Name != emp.Name {
		changed = append(changed, "name")
		from["name"] = before.Name
		to["name"] = emp.Name
	}
	if roleChanged {
		changed = append(changed, "role")
		from["role"] = before.Role
		to["role"] = emp.Role
	}
	if statusChanged {
		changed = append(changed, "status")
		from["status"] = before.Status
		to["status"] = emp.Status
	}
	actor := actorFrom(r)
	_ = h.audit.Record(r.Context(), audit.Event{
		EmployeeID: actor.id,
		ActorEmail: actor.email,
		Action:     action,
		ObjectType: "employee",
		ObjectRef:  "employee:" + emp.ID.String(),
		RequestID:  httpx.RequestIDFromContext(r.Context()),
		IP:         h.clientIP(r),
		Metadata:   map[string]any{"changed": changed, "from": from, "to": to},
	})
	httpx.WriteJSON(w, http.StatusOK, toEmployeeDTO(emp))
}

func (h *api) revokeEmployeeSessions(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if _, err := h.employees.GetRecord(r.Context(), id); err != nil {
		if errors.Is(err, employees.ErrNotFound) {
			httpx.WriteError(w, r, httpx.NotFound("employee not found"))
			return
		}
		httpx.WriteError(w, r, httpx.Internal())
		return
	}
	if err := h.sessions.RevokeAll(r.Context(), id, auth.ReasonAdmin); err != nil {
		httpx.WriteError(w, r, httpx.Internal())
		return
	}
	actor := actorFrom(r)
	_ = h.audit.Record(r.Context(), audit.Event{
		EmployeeID: actor.id,
		ActorEmail: actor.email,
		Action:     audit.ActionSessionsRevoke,
		ObjectType: "employee",
		ObjectRef:  "employee:" + id.String(),
		RequestID:  httpx.RequestIDFromContext(r.Context()),
		IP:         h.clientIP(r),
	})
	httpx.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

func (h *api) listAudit(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	filter := audit.ListFilter{
		Action: strings.TrimSpace(query.Get("action")),
		Cursor: strings.TrimSpace(query.Get("cursor")),
		Limit:  defaultAuditLimit,
	}
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 {
			httpx.WriteError(w, r, httpx.InvalidArgument("limit must be a positive integer"))
			return
		}
		filter.Limit = limit
	}
	if raw := strings.TrimSpace(query.Get("employee_id")); raw != "" {
		id, err := parseID(raw)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		filter.EmployeeID = &id
	}
	items, next, total, err := h.audit.List(r.Context(), filter)
	if err != nil {
		if errors.Is(err, audit.ErrInvalidCursor) {
			httpx.WriteError(w, r, httpx.InvalidArgument("invalid cursor"))
			return
		}
		httpx.WriteError(w, r, httpx.Internal())
		return
	}
	dtos := make([]auditDTO, 0, len(items))
	for _, item := range items {
		dtos = append(dtos, toAuditDTO(item))
	}
	httpx.WriteJSON(w, http.StatusOK, listResponse{Items: dtos, NextCursor: next, Total: &total})
}

type actor struct {
	id    *uuid.UUID
	email string
}

func actorFrom(r *http.Request) actor {
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		return actor{}
	}
	id := principal.EmployeeID
	return actor{id: &id, email: principal.Account.Email}
}

func parseID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil || id == uuid.Nil {
		return uuid.Nil, httpx.InvalidArgument("id must be a UUID")
	}
	return id, nil
}

func toEmployeeDTO(emp employees.Employee) employeeDTO {
	return employeeDTO{
		ID:        emp.ID.String(),
		Email:     emp.Email,
		Name:      emp.Name,
		Role:      emp.Role,
		Status:    emp.Status,
		CreatedAt: emp.CreatedAt.UTC(),
		UpdatedAt: emp.UpdatedAt.UTC(),
	}
}

func toMeDTO(id uuid.UUID, email, name, role string) meDTO {
	return meDTO{
		ID:          id.String(),
		Email:       email,
		Name:        name,
		Role:        role,
		Permissions: rbac.Permissions(role),
	}
}

func toSessionDTO(item auth.Session) sessionDTO {
	dto := sessionDTO{
		ID:           item.ID.String(),
		CreatedAt:    item.CreatedAt.UTC(),
		LastSeenAt:   item.LastSeenAt.UTC(),
		ExpiresAt:    item.ExpiresAt.UTC(),
		RevokeReason: item.RevokeReason,
		IP:           item.IP,
		UserAgent:    item.UserAgent,
	}
	if item.RevokedAt != nil {
		utc := item.RevokedAt.UTC()
		dto.RevokedAt = &utc
	}
	return dto
}

func toAuditDTO(item audit.Entry) auditDTO {
	dto := auditDTO{
		ID:         item.ID,
		ActorEmail: item.ActorEmail,
		Action:     item.Action,
		ObjectType: item.ObjectType,
		ObjectRef:  item.ObjectRef,
		Outcome:    item.Outcome,
		IP:         item.IP,
		Metadata:   item.Metadata,
		CreatedAt:  item.CreatedAt.UTC(),
	}
	if item.EmployeeID != nil {
		value := item.EmployeeID.String()
		dto.EmployeeID = &value
	}
	if item.RequestID != nil {
		value := item.RequestID.String()
		dto.RequestID = &value
	}
	if len(dto.Metadata) == 0 {
		dto.Metadata = json.RawMessage(`{}`)
	}
	return dto
}

func contextWithTimeout(r *http.Request, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), timeout)
}
