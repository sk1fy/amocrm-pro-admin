package httpapi

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/managerplatform"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

func registerManagerAccounts(router chi.Router, service *managerplatform.Service) {
	for _, endpoint := range managerplatform.AccountEndpoints() {
		router.Method(endpoint.Route.Method, endpoint.Route.Path, managerAccountEndpoint(service, endpoint))
	}
}

func managerAccountEndpoint(service *managerplatform.Service, endpoint managerplatform.AccountEndpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireManagerGrant(w, r, endpoint.Grant()) {
			return
		}
		if service == nil {
			httpx.WriteError(w, r, httpx.BackendUnavailable("Platform unavailable"))
			return
		}
		meta, raw, err := readManagerAccountRequest(w, r, endpoint)
		if err != nil {
			writeManagerAccountError(w, r, err)
			return
		}
		if !endpoint.Mutates() {
			response, err := service.ReadAccount(r.Context(), endpoint, meta.TargetID, r.URL.RawQuery, raw)
			if err != nil {
				writeManagerAccountError(w, r, err)
				return
			}
			writeManagerAccountResponse(w, response)
			return
		}
		result, err := service.MutateAccount(r.Context(), endpoint, meta, raw)
		if err != nil {
			writeManagerAccountError(w, r, err)
			return
		}
		if result.State == managerplatform.UnknownOutcome || result.State == managerplatform.PlatformResult {
			w.Header().Set("Location", strings.Replace(apicontract.ManagerOperation.Path, "{id}", result.ID.String(), 1))
			setManagerRetryAfter(w, result.RetryAfter)
			httpx.WriteJSON(w, http.StatusAccepted, toManagerOperationResponse(result))
			return
		}
		writeManagerAccountResponse(w, result.Response)
	}
}

func readManagerAccountRequest(w http.ResponseWriter, r *http.Request, endpoint managerplatform.AccountEndpoint) (managerplatform.CommandMeta, []byte, error) {
	var meta managerplatform.CommandMeta
	if strings.Contains(endpoint.Route.Path, "{id}") {
		id, ok := managerUUID(chi.URLParam(r, "id"))
		if !ok {
			return meta, nil, managerplatform.ErrInvalid
		}
		meta.TargetID = id
	}
	if endpoint.Mutates() {
		key, ok := managerUUID(singleHeader(r.Header, "Idempotency-Key"))
		if !ok || r.URL.RawQuery != "" {
			return meta, nil, managerplatform.ErrInvalid
		}
		meta.IdempotencyKey = key
		if endpoint.ExpectedVersion() {
			version, ok := managerReviewVersion(singleHeader(r.Header, "If-Match"))
			if !ok {
				return meta, nil, managerplatform.ErrInvalid
			}
			meta.ExpectedVersion = version
		} else if len(r.Header.Values("If-Match")) != 0 {
			return meta, nil, managerplatform.ErrInvalid
		}
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, managerplatform.ManagerAccountBodyLimit))
	if err != nil {
		return meta, nil, managerplatform.ErrInvalid
	}
	if len(raw) != 0 {
		media, _, err := mime.ParseMediaType(singleHeader(r.Header, "Content-Type"))
		if err != nil || media != "application/json" {
			return meta, nil, managerplatform.ErrInvalid
		}
	}
	return meta, raw, nil
}

type managerAccountListResponse struct {
	*wire.AccountList
	Sources []adapter.SourceStatus `json:"sources"`
}

func writeManagerAccountResponse(w http.ResponseWriter, response managerplatform.AccountResponse) {
	if response.ETag != "" {
		w.Header().Set("ETag", response.ETag)
	}
	if response.Status == http.StatusNoContent {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if page, ok := response.Data.(*wire.AccountList); ok {
		snapshot := page.SnapshotAt.UTC()
		httpx.WriteJSON(w, response.Status, managerAccountListResponse{AccountList: page, Sources: []adapter.SourceStatus{
			{Backend: "platform", Status: "available", ObservedAt: &snapshot},
		}})
		return
	}
	switch value := response.Data.(type) {
	case *wire.CompanyList:
		httpx.WriteJSON(w, response.Status, managerCompanyListResponse{CompanyList: value, Sources: companySources(value.Source), Observation: companyObservation(value.Source)})
		return
	case *wire.CompanyDetail:
		httpx.WriteJSON(w, response.Status, managerCompanyDetailResponse{CompanyDetail: value, Sources: companySources(value.Source), Observation: companyObservation(value.Source)})
		return
	case *wire.CompanyWorkflowMetadata:
		httpx.WriteJSON(w, response.Status, managerCompanyMetadataResponse{CompanyWorkflowMetadata: value, Sources: companySources(value.Source), Observation: companyObservation(value.Source)})
		return
	}
	httpx.WriteJSON(w, response.Status, response.Data)
}

func writeManagerAccountError(w http.ResponseWriter, r *http.Request, err error) {
	var peer *managerplatform.PeerError
	switch {
	case r.Context().Err() != nil:
		return
	case errors.Is(err, auth.ErrUnauthenticated):
		httpx.WriteError(w, r, httpx.Unauthenticated("authentication required"))
	case errors.Is(err, managerplatform.ErrForbidden):
		httpx.WriteError(w, r, httpx.Forbidden("manager access denied"))
	case errors.Is(err, managerplatform.ErrInvalid):
		httpx.WriteError(w, r, httpx.InvalidArgument("invalid client request"))
	case errors.Is(err, managerplatform.ErrConflict):
		httpx.WriteErrorDetails(w, r, httpx.Conflict("idempotency key already used"), map[string]any{"code": "idempotency_conflict"})
	case errors.Is(err, managerplatform.ErrUnavailable), errors.Is(err, context.DeadlineExceeded):
		httpx.WriteError(w, r, httpx.BackendUnavailable("Platform unavailable"))
	case errors.As(err, &peer):
		writeManagerAccountPeerError(w, r, peer)
	default:
		httpx.WriteError(w, r, httpx.Internal())
	}
}

func writeManagerAccountPeerError(w http.ResponseWriter, r *http.Request, peer *managerplatform.PeerError) {
	var response httpx.Error
	var details map[string]any
	switch peer.Status {
	case http.StatusBadRequest:
		response = httpx.InvalidArgument("invalid client request")
		if peer.Code == "invalid_cursor" || peer.Code == "query_too_broad" {
			details = map[string]any{"code": peer.Code}
		}
	case http.StatusForbidden:
		response = httpx.Forbidden("manager access denied")
	case http.StatusNotFound:
		response = httpx.NotFound("client resource not found")
	case http.StatusConflict:
		response = httpx.Conflict("client command conflict")
		switch peer.Code {
		case "idempotency_conflict", "product_exists", "company_source_conflict", "company_metadata_conflict":
			details = map[string]any{"code": peer.Code}
		case "state_conflict":
			details = map[string]any{"code": peer.Code}
			if peer.Version != nil && *peer.Version > 0 && *peer.Version <= managerplatform.MaxVersion {
				details["current_version"] = *peer.Version
			}
		case "version_conflict":
			if peer.Version != nil && *peer.Version > 0 && *peer.Version <= managerplatform.MaxVersion {
				details = map[string]any{"code": peer.Code, "current_version": *peer.Version}
			} else {
				response = httpx.BackendUnavailable("Platform unavailable")
			}
		default:
			response = httpx.BackendUnavailable("Platform unavailable")
		}
	case http.StatusUnprocessableEntity:
		response = httpx.InvalidArgument("client command rejected")
		response.Status = http.StatusUnprocessableEntity
		switch peer.Code {
		case "validation_failed", "business_rule_failed", "classification_unavailable", "renewal_unavailable", "target_not_extended",
			"company_stage_mismatch", "trial_policy_incompatible", "trial_evidence_required", "tariff_evidence_required", "integration_mapping_mismatch":
			details = map[string]any{"code": peer.Code}
		}
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
