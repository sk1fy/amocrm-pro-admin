package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	openapi "github.com/oapi-codegen/runtime/types"

	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/managerplatform"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/jsonbody"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

func managerInstallations(service *managerplatform.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireManagerGrant(w, r, auth.GrantClientsRead) {
			return
		}
		filters, err := managerInstallationFilters(r.URL.RawQuery)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if service == nil {
			httpx.WriteError(w, r, httpx.BackendUnavailable("Platform unavailable"))
			return
		}
		page, err := service.ListInstallations(r.Context(), filters)
		if err != nil {
			writeManagerInstallationError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, toManagerInstallationListDTO(page))
	}
}

func managerInstallationReview(service *managerplatform.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireManagerGrant(w, r, auth.GrantClientsWrite) {
			return
		}
		meta, body, err := managerReviewRequest(r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if service == nil {
			httpx.WriteError(w, r, httpx.BackendUnavailable("Platform unavailable"))
			return
		}
		result, err := service.SetInstallationReview(r.Context(), meta, body)
		if err != nil {
			writeManagerInstallationError(w, r, err)
			return
		}
		if result.State == managerplatform.UnknownOutcome {
			w.Header().Set("Location", strings.Replace(apicontract.ManagerOperation.Path, "{id}", result.ID.String(), 1))
			setManagerRetryAfter(w, result.RetryAfter)
			httpx.WriteJSON(w, http.StatusAccepted, managerOperationResponse{ID: result.ID, State: result.State})
			return
		}
		row := toManagerInstallationDTO(result.Installation)
		w.Header().Set("ETag", strconv.Quote(strconv.Itoa(row.Version)))
		httpx.WriteJSON(w, http.StatusOK, row)
	}
}

func requireManagerGrant(w http.ResponseWriter, r *http.Request, grant auth.ManagerGrant) bool {
	principal, _ := auth.PrincipalFromContext(r.Context())
	if !slices.Contains(principal.Account.ManagerGrants, grant) {
		httpx.WriteError(w, r, httpx.Forbidden("manager access denied"))
		return false
	}
	return true
}

func managerInstallationFilters(raw string) (wire.ListInstallationsParams, error) {
	var params wire.ListInstallationsParams
	bad := httpx.InvalidArgument("invalid installation filters")
	if len(raw) > 4096 {
		return params, bad
	}
	query, err := url.ParseQuery(raw)
	if err != nil {
		return params, bad
	}
	for key, entries := range query {
		if len(entries) != 1 {
			return params, bad
		}
		value := entries[0]
		if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 200 || strings.ContainsRune(value, 0) ||
			(value == "" && key != "q") {
			return params, bad
		}
		switch key {
		case "q":
			params.Q = &value
		case "cursor":
			params.Cursor = &value
		case "limit":
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || n > 100 || strconv.Itoa(n) != value {
				return params, bad
			}
			params.Limit = &n
		case "review":
			choice := wire.ListInstallationsParamsReview(value)
			if !choice.Valid() {
				return params, bad
			}
			params.Review = &choice
		case "kind":
			choice := wire.ListInstallationsParamsKind(value)
			if !choice.Valid() {
				return params, bad
			}
			params.Kind = &choice
		case "last_lifecycle_event":
			choice := wire.LifecycleKind(value)
			if !choice.Valid() {
				return params, bad
			}
			params.LastLifecycleEvent = &choice
		case "product_id":
			id, ok := managerUUID(value)
			if !ok {
				return params, bad
			}
			params.ProductId = &id
		case "line":
			choice := wire.ListInstallationsParamsLine(value)
			if !choice.Valid() {
				return params, bad
			}
			params.Line = &choice
		case "activation":
			if !wire.InstallationActivationStatus(value).Valid() {
				return params, bad
			}
			params.Activation = &value
		case "access_state":
			choice := wire.ListInstallationsParamsAccessState(value)
			if !choice.Valid() {
				return params, bad
			}
			params.AccessState = &choice
		case "from", "to":
			day, err := time.Parse(time.DateOnly, value)
			if err != nil || day.Year() == 0 || day.Format(time.DateOnly) != value {
				return params, bad
			}
			date := openapi.Date{Time: day}
			if key == "from" {
				params.From = &date
			} else {
				params.To = &date
			}
		case "sort":
			choice := wire.ListInstallationsParamsSort(value)
			if !choice.Valid() {
				return params, bad
			}
			params.Sort = &choice
		default:
			return params, bad
		}
	}
	if params.From != nil && params.To != nil && params.From.After(params.To.Time) {
		return params, bad
	}
	return params, nil
}

func managerReviewRequest(r *http.Request) (managerplatform.CommandMeta, wire.SetInstallationReviewJSONRequestBody, error) {
	var meta managerplatform.CommandMeta
	var body wire.SetInstallationReviewJSONRequestBody
	bad := httpx.InvalidArgument("invalid installation review request")
	id, idOK := managerUUID(chi.URLParam(r, "id"))
	key, keyOK := managerUUID(singleHeader(r.Header, "Idempotency-Key"))
	version, matchOK := managerReviewVersion(singleHeader(r.Header, "If-Match"))
	media, _, mediaErr := mime.ParseMediaType(singleHeader(r.Header, "Content-Type"))
	if !idOK || !keyOK || !matchOK || mediaErr != nil || media != "application/json" || r.URL.RawQuery != "" {
		return meta, body, bad
	}
	var review reviewRequest
	if err := jsonbody.DecodeObject(r.Body, 16<<10, &review); err != nil {
		return meta, body, bad
	}
	meta = managerplatform.CommandMeta{TargetID: id, IdempotencyKey: key, ExpectedVersion: version}
	return meta, review.body, nil
}

type reviewRequest struct {
	body wire.SetInstallationReviewJSONRequestBody
}

func (request *reviewRequest) UnmarshalJSON(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if delim, err := decoder.Token(); err != nil || delim != json.Delim('{') || !utf8.Valid(raw) {
		return jsonbody.ErrInvalid
	}
	var reviewed *bool
	fields := map[string]any{"reviewed": &reviewed, "reason": &request.body.Reason}
	for decoder.More() {
		key, err := decoder.Token()
		name, ok := key.(string)
		field, found := fields[name]
		if err != nil || !ok || !found {
			return jsonbody.ErrInvalid
		}
		delete(fields, name)
		var member json.RawMessage
		if err := decoder.Decode(&member); err != nil || bytes.Equal(member, []byte("null")) ||
			json.Unmarshal(member, field) != nil {
			return jsonbody.ErrInvalid
		}
	}
	if reviewed == nil {
		return jsonbody.ErrInvalid
	}
	request.body.Reviewed = *reviewed
	return nil
}

func singleHeader(headers http.Header, key string) string {
	values := headers.Values(key)
	if len(values) != 1 {
		return ""
	}
	return values[0]
}

func managerUUID(raw string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	return id, err == nil && id != uuid.Nil && strings.EqualFold(raw, id.String())
}

func managerReviewVersion(raw string) (int64, bool) {
	if len(raw) < 3 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return 0, false
	}
	number := raw[1 : len(raw)-1]
	value, err := strconv.ParseInt(number, 10, 64)
	return value, err == nil && value > 0 && value <= managerplatform.MaxVersion && strconv.FormatInt(value, 10) == number
}

func writeManagerInstallationError(w http.ResponseWriter, r *http.Request, err error) {
	var peer *managerplatform.PeerError
	switch {
	case r.Context().Err() != nil:
		return
	case errors.Is(err, auth.ErrUnauthenticated):
		httpx.WriteError(w, r, httpx.Unauthenticated("authentication required"))
	case errors.Is(err, managerplatform.ErrForbidden):
		httpx.WriteError(w, r, httpx.Forbidden("manager access denied"))
	case errors.Is(err, managerplatform.ErrInvalid):
		httpx.WriteError(w, r, httpx.InvalidArgument("invalid installation review request"))
	case errors.Is(err, managerplatform.ErrConflict):
		httpx.WriteErrorDetails(w, r, httpx.Conflict("idempotency key already used"), map[string]any{"code": "idempotency_conflict"})
	case errors.Is(err, managerplatform.ErrUnavailable), errors.Is(err, context.DeadlineExceeded):
		httpx.WriteError(w, r, httpx.BackendUnavailable("Platform unavailable"))
	case errors.As(err, &peer):
		writeManagerInstallationPeerError(w, r, peer)
	default:
		httpx.WriteError(w, r, httpx.Internal())
	}
}

func writeManagerInstallationPeerError(w http.ResponseWriter, r *http.Request, peer *managerplatform.PeerError) {
	var response httpx.Error
	var details map[string]any
	switch peer.Status {
	case http.StatusBadRequest:
		response = httpx.InvalidArgument("invalid installation request")
		switch peer.Code {
		case "invalid_cursor", "query_too_broad":
			details = map[string]any{"code": peer.Code}
		}
	case http.StatusForbidden:
		response = httpx.Forbidden("manager access denied")
	case http.StatusNotFound:
		response = httpx.NotFound("installation not found")
	case http.StatusConflict:
		response = httpx.Conflict("installation review conflict")
		switch peer.Code {
		case "idempotency_conflict", "version_conflict":
			details = map[string]any{"code": peer.Code}
			if peer.Code == "version_conflict" && peer.Version != nil && *peer.Version > 0 && *peer.Version <= managerplatform.MaxVersion {
				details["current_version"] = *peer.Version
			}
		}
	case http.StatusUnprocessableEntity:
		response = httpx.InvalidArgument("installation review rejected")
		response.Status = http.StatusUnprocessableEntity
	case http.StatusTooManyRequests:
		response = httpx.RateLimited("Platform is busy")
		setManagerRetryAfter(w, peer.RetryAfter)
	case http.StatusServiceUnavailable:
		response = httpx.BackendUnavailable("Platform unavailable")
		setManagerRetryAfter(w, peer.RetryAfter)
	default:
		response = httpx.BackendUnavailable("Platform unavailable")
	}
	httpx.WriteErrorDetails(w, r, response, details)
}

func setManagerRetryAfter(w http.ResponseWriter, retryAfter *int) {
	if retryAfter != nil && *retryAfter >= 0 {
		w.Header().Set("Retry-After", strconv.Itoa(*retryAfter))
	}
}
