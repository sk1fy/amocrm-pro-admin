package managerplatform

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/google/uuid"

	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/jsonbody"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

const ManagerAccountBodyLimit = 32 << 10

type AccountResponse struct {
	Status int
	ETag   string
	Data   any
}

type accountAction string

type AccountEndpoint struct {
	Route  apicontract.Route
	action accountAction
	kind   commandKind
	status int
	model  func() any
}

func (e AccountEndpoint) Mutates() bool         { return e.kind != "" }
func (e AccountEndpoint) ExpectedVersion() bool { return e.kind.policy().version }
func (e AccountEndpoint) Grant() auth.ManagerGrant {
	if e.Mutates() {
		return e.kind.policy().grant
	}
	return auth.GrantClientsRead
}

func newManagerModel[T any]() any { return new(T) }

func AccountEndpoints() []AccountEndpoint {
	return []AccountEndpoint{
		{apicontract.ManagerAccounts, "listAccounts", "", http.StatusOK, newManagerModel[wire.AccountList]},
		{apicontract.ManagerAccountSearch, "searchAccounts", "", http.StatusOK, newManagerModel[wire.AccountList]},
		{apicontract.ManagerAccount, "getAccount", "", http.StatusOK, newManagerModel[wire.AccountDetail]},
		{apicontract.ManagerAccountProfile, "updateAccountProfile", kindProfile, http.StatusOK, newManagerModel[wire.AccountDetail]},
		{apicontract.ManagerAccountRefresh, "requestAccountRefresh", kindRefresh, http.StatusAccepted, newManagerModel[wire.Operation]},
		{apicontract.ManagerAccountLicenseHistory, "getAccountLicenseHistory", "", http.StatusOK, newManagerModel[wire.LicenseEvidenceList]},
		{apicontract.ManagerAccountWidgets, "listAccountWidgets", "", http.StatusOK, newManagerModel[wire.InstallationList]},
		{apicontract.ManagerAccountCRMUsers, "getAccountCRMUsers", "", http.StatusOK, newManagerModel[wire.ObservationCRMUsers]},
		{apicontract.ManagerAccountRenewal, "createAccountRenewal", kindRenewal, http.StatusCreated, newManagerModel[wire.Renewal]},
		{apicontract.ManagerAccountPortrait, "getAccountPortrait", "", http.StatusOK, newManagerModel[wire.Portrait]},
		{apicontract.ManagerAccountPortraitUpdate, "updateAccountPortrait", kindPortrait, http.StatusOK, newManagerModel[wire.Portrait]},
		{apicontract.ManagerPortraitAuditDate, "createPortraitAuditDate", kindAuditDate, http.StatusOK, newManagerModel[wire.Portrait]},
		{apicontract.ManagerPortraitTemplate, "getPortraitTemplate", "", http.StatusOK, newManagerModel[wire.PortraitTemplate]},
		{apicontract.ManagerPortraitTemplateUpdate, "setPortraitTemplate", kindTemplate, http.StatusOK, newManagerModel[wire.PortraitTemplate]},
		{apicontract.ManagerPortraitNiches, "listPortraitNiches", "", http.StatusOK, newManagerModel[wire.NicheList]},
		{apicontract.ManagerPortraitNicheCreate, "createPortraitNiche", kindCreateNiche, http.StatusCreated, newManagerModel[wire.Niche]},
		{apicontract.ManagerPortraitNicheUpdate, "updatePortraitNiche", kindUpdateNiche, http.StatusOK, newManagerModel[wire.Niche]},
		{apicontract.ManagerPortraitNicheDelete, "deletePortraitNiche", kindDeleteNiche, http.StatusNoContent, nil},
		{apicontract.ManagerPortraitNicheMerge, "mergePortraitNiche", kindMergeNiche, http.StatusOK, newManagerModel[wire.Niche]},
	}
}

func (c *Client) accountContract(endpoint AccountEndpoint) *openapi3.Operation {
	path := "/internal/platform/v1/managers" + strings.TrimPrefix(endpoint.Route.Path, apicontract.ManagerPrefix)
	item := c.contract.Paths.Find(path)
	if item == nil {
		return nil
	}
	return item.GetOperation(endpoint.Route.Method)
}

func accountQuery(operation *openapi3.Operation, raw string) (url.Values, error) {
	if len(raw) > 4096 {
		return nil, ErrInvalid
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return nil, ErrInvalid
	}
	for key, entries := range values {
		param := operation.Parameters.GetByInAndName("query", key)
		if param == nil || param.Schema == nil || len(entries) == 0 || len(entries) > 30 {
			return nil, ErrInvalid
		}
		schema := param.Schema.Value
		if schema.Type.Is("array") {
			items := make([]any, 0, len(entries))
			for _, value := range entries {
				if !validQueryText(value, false) {
					return nil, ErrInvalid
				}
				items = append(items, value)
			}
			if schema.VisitJSON(items, openapi3.EnableFormatValidation()) != nil {
				return nil, ErrInvalid
			}
			continue
		}
		if len(entries) != 1 || !validQueryText(entries[0], key == "q") {
			return nil, ErrInvalid
		}
		value := entries[0]
		var decoded any = value
		switch {
		case schema.Format == "uuid":
			id, err := uuid.Parse(value)
			if err != nil || id == uuid.Nil || !strings.EqualFold(id.String(), value) {
				return nil, ErrInvalid
			}
		case schema.Type.Is("integer"):
			number, err := strconv.Atoi(value)
			if err != nil || number < 0 || number > MaxVersion || strconv.Itoa(number) != value {
				return nil, ErrInvalid
			}
			decoded = float64(number)
		case schema.Type.Is("boolean"):
			if value != "true" && value != "false" {
				return nil, ErrInvalid
			}
			decoded = value == "true"
		}
		if schema.VisitJSON(decoded, openapi3.EnableFormatValidation()) != nil {
			return nil, ErrInvalid
		}
	}
	return values, nil
}

func validQueryText(value string, empty bool) bool {
	return (empty || value != "") && len(value) <= 1024 && utf8.ValidString(value) && !strings.ContainsRune(value, 0)
}

func accountBody(operation *openapi3.Operation, raw []byte) ([]byte, error) {
	if operation.RequestBody == nil {
		if len(bytes.TrimSpace(raw)) != 0 {
			return nil, ErrInvalid
		}
		return nil, nil
	}
	if !validManagerJSON(raw) {
		return nil, ErrInvalid
	}
	normalized, err := jsonbody.CanonicalObject(raw)
	if err != nil {
		return nil, ErrInvalid
	}
	var value any
	if json.Unmarshal(normalized, &value) != nil {
		return nil, ErrInvalid
	}
	content := operation.RequestBody.Value.Content.Get("application/json")
	if content == nil || content.Schema == nil || content.Schema.Value.VisitJSON(value, openapi3.EnableFormatValidation()) != nil {
		return nil, ErrInvalid
	}
	return normalized, nil
}

func validManagerJSON(raw []byte) bool {
	if !utf8.Valid(raw) {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if !readUniqueJSONValue(decoder, 0) {
		return false
	}
	_, err := decoder.Token()
	return errors.Is(err, io.EOF)
}

func readUniqueJSONValue(decoder *json.Decoder, depth int) bool {
	if depth > 16 {
		return false
	}
	token, err := decoder.Token()
	if err != nil {
		return false
	}
	switch token {
	case json.Delim('{'):
		seen := make(map[string]bool)
		for decoder.More() {
			key, err := decoder.Token()
			name, ok := key.(string)
			if err != nil || !ok || strings.ContainsRune(name, 0) || seen[name] || !readUniqueJSONValue(decoder, depth+1) {
				return false
			}
			seen[name] = true
		}
		_, err = decoder.Token()
	case json.Delim('['):
		for decoder.More() {
			if !readUniqueJSONValue(decoder, depth+1) {
				return false
			}
		}
		_, err = decoder.Token()
	default:
		if value, ok := token.(string); ok {
			return !strings.ContainsRune(value, 0)
		}
	}
	return err == nil
}

func (s *Service) ReadAccount(ctx context.Context, endpoint AccountEndpoint, target uuid.UUID, rawQuery string, raw []byte) (AccountResponse, error) {
	if endpoint.Mutates() {
		return AccountResponse{}, ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, maxTimeout)
	defer cancel()
	identity, ok := auth.PrincipalFromContext(ctx)
	if !ok || identity.Audience != auth.Managers {
		return AccountResponse{}, auth.ErrUnauthenticated
	}
	actor, err := s.snapshot(ctx, identity.SessionID, identity.EmployeeID, endpoint.Grant())
	if err != nil {
		return AccountResponse{}, err
	}
	operation := s.client.accountContract(endpoint)
	if operation == nil {
		return AccountResponse{}, ErrUnavailable
	}
	query, err := accountQuery(operation, rawQuery)
	if err != nil {
		return AccountResponse{}, err
	}
	body, err := accountBody(operation, raw)
	if err != nil {
		return AccountResponse{}, err
	}
	response, err := s.client.clientAccountRequest(ctx, actor, operation, endpoint, target, query, body, intent{})
	current, accessErr := s.snapshot(context.WithoutCancel(ctx), actor.SessionID, actor.EmployeeID, endpoint.Grant())
	if accessErr != nil {
		return AccountResponse{}, accessErr
	}
	if current.Account.ManagerGrantsVersion != actor.Account.ManagerGrantsVersion {
		if query.Has("cursor") {
			return AccountResponse{}, &PeerError{Status: http.StatusBadRequest, Code: "invalid_cursor"}
		}
		return AccountResponse{}, ErrUnavailable
	}
	return response, err
}

func (s *Service) MutateAccount(ctx context.Context, endpoint AccountEndpoint, meta CommandMeta, raw []byte) (Result, error) {
	if !endpoint.Mutates() {
		return Result{}, ErrInvalid
	}
	operation := s.client.accountContract(endpoint)
	if operation == nil {
		return Result{}, ErrUnavailable
	}
	body, err := accountBody(operation, raw)
	if err != nil {
		return Result{}, err
	}
	if endpoint.kind.policy().related {
		var targets struct {
			ProductID uuid.UUID `json:"product_id"`
			TargetID  uuid.UUID `json:"target_id"`
		}
		if json.Unmarshal(body, &targets) != nil {
			return Result{}, ErrInvalid
		}
		meta.RelatedID = targets.ProductID
		if endpoint.kind == kindMergeNiche {
			meta.RelatedID = targets.TargetID
		}
	}
	hashBody := json.RawMessage(body)
	if len(hashBody) == 0 {
		hashBody = json.RawMessage("{}")
	}
	return s.send(ctx, endpoint.kind, meta, hashBody, func(ctx context.Context, actor auth.Principal, item intent) (Result, error) {
		response, err := s.client.clientAccountRequest(ctx, actor, operation, endpoint, meta.TargetID, nil, body, item)
		result := Result{ID: item.ID, State: ReceiptDone, Response: response}
		if op, ok := response.Data.(*wire.Operation); ok {
			result.State, result.Operation = PlatformResult, op
		}
		return result, err
	})
}

func (c *Client) clientAccountRequest(ctx context.Context, principal auth.Principal, operation *openapi3.Operation,
	endpoint AccountEndpoint, target uuid.UUID, query url.Values, body []byte, item intent,
) (AccountResponse, error) {
	actor, err := c.actor(ctx, principal, nullableManagerID(item.ID))
	if err != nil {
		return AccountResponse{}, err
	}
	response, err := c.callAccount(ctx, endpoint.action, actor, target, query, body, item)
	if err != nil {
		return AccountResponse{}, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return AccountResponse{}, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	if response.StatusCode != endpoint.status {
		return AccountResponse{}, peerError(response, raw)
	}
	if response.StatusCode == http.StatusNoContent && len(raw) == 0 {
		return AccountResponse{Status: http.StatusNoContent}, nil
	}
	if !jsonMedia(response) {
		return AccountResponse{}, ErrUnavailable
	}
	res := operation.Responses.Status(endpoint.status)
	if res == nil {
		return AccountResponse{}, ErrUnavailable
	}
	content := res.Value.Content.Get("application/json")
	var generic any
	if content == nil || content.Schema == nil || !validManagerJSON(raw) || json.Unmarshal(raw, &generic) != nil ||
		content.Schema.Value.VisitJSON(generic, openapi3.EnableFormatValidation()) != nil {
		return AccountResponse{}, ErrUnavailable
	}
	dto := endpoint.model()
	if json.Unmarshal(raw, dto) != nil || !validManagerAccountDTO(dto, target, query, raw, response, item) {
		return AccountResponse{}, ErrUnavailable
	}
	var etag string
	if version := accountResponseVersion(dto); version != 0 {
		etag = strconv.Quote(strconv.Itoa(version))
		if tags := response.Header.Values("ETag"); len(tags) != 1 || tags[0] != etag {
			return AccountResponse{}, ErrUnavailable
		}
	}
	return AccountResponse{Status: response.StatusCode, ETag: etag, Data: dto}, nil
}

func accountResponseVersion(value any) int {
	switch model := value.(type) {
	case *wire.AccountDetail:
		return model.Version
	case *wire.Portrait:
		return model.Version
	case *wire.PortraitTemplate:
		return model.Version
	case *wire.Niche:
		return model.Version
	case *wire.Renewal:
		return model.Access.EntitlementVersion
	}
	return 0
}

func validManagerAccountDTO(
	value any, target uuid.UUID, query url.Values, raw []byte, response *http.Response, item intent,
) bool {
	switch model := value.(type) {
	case *wire.AccountList:
		limit := 25
		if requested := query.Get("limit"); requested != "" {
			limit, _ = strconv.Atoi(requested)
		}
		hash, err := hex.DecodeString(model.QueryHash)
		cursor, cursorErr := model.NextCursor.Get()
		if model.Items == nil || model.SnapshotAt.IsZero() || !model.NextCursor.IsSpecified() ||
			err != nil || len(hash) != 32 || (cursorErr == nil && (cursor == "" || len(cursor) > 1024)) ||
			len(model.Items) > min(limit, model.Summary.Total) {
			return false
		}
		seen := make(map[uuid.UUID]bool, len(model.Items))
		for _, account := range model.Items {
			if account.AccountId == uuid.Nil || seen[account.AccountId] {
				return false
			}
			seen[account.AccountId] = true
		}
	case *wire.AccountDetail:
		return model.AccountId == target && model.Version > 0
	case *wire.InstallationList:
		var limit *int
		if requested := query.Get("limit"); requested != "" {
			value, _ := strconv.Atoi(requested)
			limit = &value
		}
		for _, widget := range model.Items {
			if widget.AccountId != target {
				return false
			}
		}
		return validInstallationList(response, raw, model, limit)
	case *wire.LicenseEvidenceList:
		for _, evidence := range model.Items {
			if evidence.AccountId != target || evidence.Id == uuid.Nil {
				return false
			}
		}
	case *wire.ObservationCRMUsers:
		if model.Source == "" {
			return false
		}
		if model.State != wire.FreshnessFresh && model.State != wire.FreshnessStale {
			return model.Value == nil
		}
		if model.Value == nil || model.ObservedAt == nil || model.FreshUntil == nil ||
			model.ObservedAt.IsZero() || model.FreshUntil.Before(*model.ObservedAt) {
			return false
		}
		seen := make(map[wire.AmoID]bool, len(*model.Value))
		for _, user := range *model.Value {
			id, err := strconv.ParseInt(string(user.Id), 10, 64)
			if err != nil || id < 1 || seen[user.Id] {
				return false
			}
			seen[user.Id] = true
		}
	case *wire.Portrait:
		return model.AccountId == target && model.Version > 0
	case *wire.Renewal:
		return model.Id != uuid.Nil && model.AccountId == target && model.ProductId == item.RelatedID &&
			model.Access.AccountId == target && model.Access.ProductId == item.RelatedID && model.Access.EntitlementVersion > int(item.Version)
	case *wire.Niche:
		if item.Kind == kindMergeNiche {
			return model.Id == item.RelatedID
		}
		return model.Id != uuid.Nil && (target == uuid.Nil || model.Id == target)
	case *wire.Operation:
		return validOperation(model, item) && response.Header.Get("Location") == "/internal/platform/v1/managers/operations/"+item.ID.String()
	}
	return true
}
