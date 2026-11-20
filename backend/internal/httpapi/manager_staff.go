package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/jsonbody"
)

type managerStaffHandler struct {
	access *employees.Access
	origin string
}

func registerManagerStaff(r chi.Router, h managerStaffHandler) {
	r.MethodFunc(apicontract.ManagerStaff.Method, apicontract.ManagerStaff.Path, h.list)
	r.MethodFunc(apicontract.ManagerStaffGrants.Method, apicontract.ManagerStaffGrants.Path, h.grants)
	r.MethodFunc(apicontract.ManagerStaffMember.Method, apicontract.ManagerStaffMember.Path, h.get)
	r.MethodFunc(apicontract.ManagerSecurityAudit.Method, apicontract.ManagerSecurityAudit.Path, h.audit)
	for _, item := range []struct {
		route apicontract.Route
		kind  string
	}{
		{apicontract.ManagerStaffCreate, "invite"}, {apicontract.ManagerStaffUpdate, "grants"},
		{apicontract.ManagerInvitationReissue, "reissue"}, {apicontract.ManagerStaffSessionsRevoke, "revoke_sessions"},
	} {
		r.Method(item.route.Method, item.route.Path, h.command(item.kind))
	}
}
func managerStaffSession(r *http.Request) uuid.UUID {
	p, _ := auth.PrincipalFromContext(r.Context())
	return p.SessionID
}
func managerStaffLimit(r *http.Request) (int, error) {
	values := r.URL.Query()["limit"]
	if len(values) > 1 {
		return 0, employees.ErrStaffInvalid
	}
	if len(values) == 0 || values[0] == "" {
		return 25, nil
	}
	n, err := strconv.Atoi(values[0])
	if err != nil || n < 1 || n > 100 {
		return 0, employees.ErrStaffInvalid
	}
	return n, nil
}
func managerStaffQueries(r *http.Request, allowed ...string) bool {
	for key, values := range r.URL.Query() {
		if len(values) != 1 {
			return false
		}
		found := false
		for _, a := range allowed {
			if key == a {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	return true
}
func (h managerStaffHandler) list(w http.ResponseWriter, r *http.Request) {
	limit, err := managerStaffLimit(r)
	if err != nil || !managerStaffQueries(r, "limit", "cursor", "search") {
		writeManagerStaffError(w, r, employees.ErrStaffInvalid)
		return
	}
	page, err := h.access.ManagerStaffList(r.Context(), managerStaffSession(r), r.URL.Query().Get("search"), r.URL.Query().Get("cursor"), limit)
	if err != nil {
		writeManagerStaffError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}
func (h managerStaffHandler) grants(w http.ResponseWriter, r *http.Request) {
	items, err := h.access.ManagerGrantCatalog(r.Context(), managerStaffSession(r))
	if err != nil {
		writeManagerStaffError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}
func (h managerStaffHandler) get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeManagerStaffError(w, r, employees.ErrStaffInvalid)
		return
	}
	item, err := h.access.ManagerStaffGet(r.Context(), managerStaffSession(r), id)
	if err != nil {
		writeManagerStaffError(w, r, err)
		return
	}
	w.Header().Set("ETag", `"`+strconv.FormatInt(item.Version, 10)+`"`)
	httpx.WriteJSON(w, http.StatusOK, item)
}
func (h managerStaffHandler) audit(w http.ResponseWriter, r *http.Request) {
	limit, err := managerStaffLimit(r)
	if err != nil || !managerStaffQueries(r, "limit", "cursor") {
		writeManagerStaffError(w, r, employees.ErrStaffInvalid)
		return
	}
	page, err := h.access.ManagerSecurityAudit(r.Context(), managerStaffSession(r), r.URL.Query().Get("cursor"), limit)
	if err != nil {
		writeManagerStaffError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}
func managerStaffVersion(r *http.Request) (int64, error) {
	raw := singleHeader(r.Header, "If-Match")
	if len(raw) < 3 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return 0, employees.ErrStaffInvalid
	}
	digits := raw[1 : len(raw)-1]
	n, err := strconv.ParseInt(digits, 10, 64)
	if err != nil || n < 1 || n > 9007199254740991 || strconv.FormatInt(n, 10) != digits {
		return 0, employees.ErrStaffInvalid
	}
	return n, nil
}
func (h managerStaffHandler) command(kind string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key, err := uuid.Parse(singleHeader(r.Header, "Idempotency-Key"))
		if err != nil || key == uuid.Nil {
			writeManagerStaffError(w, r, employees.ErrStaffInvalid)
			return
		}
		c := employees.StaffCommand{Kind: kind, SessionID: managerStaffSession(r), CommandID: key, Event: audit.Event{RequestID: httpx.RequestIDFromContext(r.Context()), IP: auth.ClientIP(r)}}
		if kind != "invite" {
			c.TargetID, err = uuid.Parse(chi.URLParam(r, "id"))
			if err != nil {
				writeManagerStaffError(w, r, employees.ErrStaffInvalid)
				return
			}
		}
		if kind == "grants" || kind == "reissue" {
			c.Version, err = managerStaffVersion(r)
			if err != nil {
				writeManagerStaffError(w, r, err)
				return
			}
		}
		switch kind {
		case "invite":
			var body struct {
				Email  string              `json:"email"`
				Name   string              `json:"name"`
				Grants []auth.ManagerGrant `json:"grants"`
			}
			if err := decodeManagerStaffJSON(r, &body); err != nil {
				writeManagerStaffError(w, r, employees.ErrStaffInvalid)
				return
			}
			c.Email, c.Name, c.Grants = body.Email, body.Name, body.Grants
		case "grants":
			var body struct {
				Grants        json.RawMessage `json:"grants"`
				AccessEnabled json.RawMessage `json:"access_enabled"`
			}
			if err := decodeManagerStaffJSON(r, &body); err != nil {
				writeManagerStaffError(w, r, employees.ErrStaffInvalid)
				return
			}
			switch {
			case len(body.Grants) != 0 && len(body.AccessEnabled) == 0:
				err = json.Unmarshal(body.Grants, &c.Grants)
			case len(body.AccessEnabled) != 0 && len(body.Grants) == 0:
				c.Kind = "access"
				err = json.Unmarshal(body.AccessEnabled, &c.AccessEnabled)
			default:
				err = employees.ErrStaffInvalid
			}
			if err != nil {
				writeManagerStaffError(w, r, employees.ErrStaffInvalid)
				return
			}
		default:
			if r.ContentLength != 0 {
				var body struct{}
				if err := decodeManagerStaffJSON(r, &body); err != nil {
					writeManagerStaffError(w, r, employees.ErrStaffInvalid)
					return
				}
			}
		}
		result, token, err := h.access.ManagerStaffCommand(r.Context(), c)
		if err != nil {
			writeManagerStaffError(w, r, err)
			return
		}
		if token != "" {
			result.InvitationURL = strings.TrimRight(h.origin, "/") + "/managers#invitation=" + token
		}
		w.Header().Set("ETag", `"`+strconv.FormatInt(result.Staff.Version, 10)+`"`)
		status := http.StatusOK
		if kind == "invite" {
			status = http.StatusCreated
		}
		httpx.WriteJSON(w, status, result)
	})
}
func (h managerStaffHandler) accept(limiter *auth.Limiter, trustProxy bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := auth.ClientIPFrom(r, trustProxy)
		if !limiter.Allow(ip, "manager-invitation-accept:"+ip) {
			httpx.WriteError(w, r, httpx.RateLimited("too many attempts"))
			return
		}
		var body struct {
			Token    string `json:"token"`
			Password string `json:"password"`
		}
		if err := decodeManagerStaffJSON(r, &body); err != nil {
			writeManagerStaffError(w, r, employees.ErrStaffInvalid)
			return
		}
		key, keyErr := uuid.Parse(singleHeader(r.Header, "Idempotency-Key"))
		if keyErr != nil || key == uuid.Nil {
			writeManagerStaffError(w, r, employees.ErrStaffInvalid)
			return
		}
		err := h.access.AcceptManagerInvitation(r.Context(), body.Token, body.Password, key, audit.Event{RequestID: httpx.RequestIDFromContext(r.Context()), IP: ip})
		if err != nil {
			writeManagerStaffError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"accepted": true})
	})
}
func writeManagerStaffError(w http.ResponseWriter, r *http.Request, err error) {
	var response httpx.Error
	code := ""
	switch {
	case errors.Is(err, auth.ErrUnauthenticated):
		response = httpx.Unauthenticated("authentication required")
	case errors.Is(err, employees.ErrStaffForbidden):
		response = httpx.Forbidden("manager access denied")
	case errors.Is(err, employees.ErrSelfEscalation):
		response = httpx.Forbidden("self grant addition is forbidden")
		code = "self_escalation"
	case errors.Is(err, employees.ErrStaffInvalid):
		response = httpx.InvalidArgument("invalid staff request")
	case errors.Is(err, employees.ErrNotFound):
		response = httpx.NotFound("staff member not found")
	case errors.Is(err, employees.ErrConflict):
		response = httpx.Conflict("email already exists")
		code = "email_exists"
	case errors.Is(err, employees.ErrStaffVersion):
		response = httpx.Conflict("staff version changed")
		code = "version_conflict"
	case errors.Is(err, employees.ErrStaffIdempotency):
		response = httpx.Conflict("command already used")
		code = "idempotency_conflict"
	case errors.Is(err, employees.ErrLastManagerAdmin):
		response = httpx.Conflict("last manager administrator must remain")
		code = "last_administrator"
	case errors.Is(err, employees.ErrInvitation):
		response = httpx.Conflict("invitation unavailable")
		code = "invitation_unavailable"
	default:
		response = httpx.Internal()
	}
	if code == "" {
		httpx.WriteError(w, r, response)
		return
	}
	httpx.WriteErrorDetails(w, r, response, map[string]any{"code": code})
}

func decodeManagerStaffJSON(r *http.Request, dest any) error {
	defer func() { _ = r.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil || len(raw) > maxBodyBytes {
		return employees.ErrStaffInvalid
	}
	defer clear(raw)
	decoder := json.NewDecoder(bytes.NewReader(raw))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return employees.ErrStaffInvalid
	}
	seen := map[string]bool{}
	for decoder.More() {
		key, err := decoder.Token()
		name, ok := key.(string)
		if err != nil || !ok || seen[name] {
			return employees.ErrStaffInvalid
		}
		seen[name] = true
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return employees.ErrStaffInvalid
		}
	}
	return jsonbody.DecodeObject(bytes.NewReader(raw), maxBodyBytes, dest)
}
