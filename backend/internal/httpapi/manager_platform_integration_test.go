package httpapi

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/legacy"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/managerplatform"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestManagerPlatformRecoversAfterLostResponse(t *testing.T) {
	const managerOrigin = "https://managers.example.invalid"
	const adminOrigin = "https://admin.example.invalid"
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := t.Context()
	store := employees.NewStore(pool, 2*time.Second)
	audits := audit.NewStore(pool, 2*time.Second)
	sessions := auth.NewManagerService(pool, 8*time.Second, time.Hour, time.Hour, true)
	core := auth.NewService(pool, 8*time.Second, time.Hour, time.Hour, true)
	employee := createEmployee(t, ctx, store, "manager@example.invalid", "Fixture Manager", rbac.RoleViewer)
	other := createEmployee(t, ctx, store, "second@example.invalid", "Second Manager", rbac.RoleAdmin)
	if err := employees.NewAccess(store, core, audits).BootstrapManager(ctx, employee.Email, audit.Event{}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO manager_grants(employee_id, grant_code) VALUES ($1, 'clients.read')", other.ID); err != nil {
		t.Fatal(err)
	}
	login := func(service *auth.Service, email string) (string, auth.Principal) {
		t.Helper()
		token, _, err := service.Login(ctx, email, testPassword, "", "")
		if err != nil {
			t.Fatal(err)
		}
		principal, err := service.Lookup(ctx, token)
		if err != nil {
			t.Fatal(err)
		}
		return token, principal
	}
	token, principal := login(sessions, employee.Email)
	otherToken, _ := login(sessions, other.Email)
	coreToken, _ := login(core, employee.Email)
	managerCtx := auth.ContextWithPrincipal(ctx, principal)

	platformSpec := loadManagerPlatformTestSpec(t, "platform-v1-openapi.yaml")
	platformRouter, err := legacy.NewRouter(platformSpec)
	if err != nil {
		t.Fatal(err)
	}
	actorSchema := platformSpec.Components.Schemas["ManagerContext"].Value
	meta := managerplatform.CommandMeta{TargetID: uuid.New(), IdempotencyKey: uuid.New(), ExpectedVersion: 42}
	body := wire.RetryInstallationDealJSONRequestBody{Reason: "fixture retry"}
	reviewMeta := managerplatform.CommandMeta{TargetID: meta.TargetID, IdempotencyKey: uuid.New(), ExpectedVersion: 42}
	reason := "fixture review"
	reviewBody := wire.SetInstallationReviewJSONRequestBody{Reviewed: true, Reason: &reason}
	accountID, productID, coreInstallationID := uuid.New(), uuid.New(), uuid.New()
	var reviewID uuid.UUID
	var reviewRequests, reviewEffects, listRequests int
	staleKey, unavailableKey := uuid.New(), uuid.New()
	const opaqueCursor = "opaque-v1_+!=tail"
	grantVersion := 2
	var mu sync.Mutex
	var commandID uuid.UUID
	var mutations, effects, receipts, operations int
	effectReady, releaseEffect := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseEffect) }) }
	defer release()
	receiptStatus := http.StatusOK
	workerObserved := make(chan struct{}, 10)
	now := time.Now().UTC().Truncate(time.Second)

	operation := func() wire.Operation {
		value := wire.Operation{Id: commandID, Kind: "installation.crm_deal.retry", CreatedAt: now, UpdatedAt: now, State: wire.OperationStateSucceeded}
		value.Target.Kind, value.Target.Id = "installation", meta.TargetID
		value.Error = &wire.Error{}
		value.Error.Error.Code = "fixture_failure"
		value.Error.Error.Message = "undisclosed upstream debug"
		value.Error.Error.RequestId = uuid.New()
		return value
	}
	errorBody := func(code string) wire.Error {
		var problem wire.Error
		problem.Error.Code, problem.Error.Message, problem.Error.RequestId = code, "private upstream detail", uuid.New()
		return problem
	}
	installation := func() map[string]any {
		return map[string]any{
			"id": reviewMeta.TargetID, "account_id": accountID, "amo_account_id": "9223372036854775807",
			"product_id": productID, "product_code": "fixture-product", "product_name": "Fixture Product",
			"core_installation_id": coreInstallationID, "generation": 1, "kind": "install",
			"installed_at": now, "removed_at": nil, "last_lifecycle_event": "installed", "lifecycle": "current",
			"authorization": "authorized", "activation_status": "pending", "crm_workflow": "unsupported",
			"review":  map[string]any{"reviewed": true, "reviewed_by": employee.ID, "reviewed_at": now},
			"version": 43,
			"access": map[string]any{"account_id": accountID, "product_id": productID,
				"active": false, "valid_until": nil, "source": "none", "reason_codes": []string{},
				"own_until": nil, "entitlement_version": 1, "computed_at": now},
		}
	}
	wantFilters := url.Values{
		"q": {"Фикстура + a"}, "review": {"reviewed"}, "kind": {"install"}, "last_lifecycle_event": {"installed"},
		"product_id": {productID.String()}, "line": {"FREE"}, "activation": {"pending"}, "access_state": {"inactive"},
		"from": {"2026-11-01"}, "to": {"2026-11-17"}, "sort": {"installed_at"}, "limit": {"1"}, "cursor": {opaqueCursor},
	}
	removeFixtureGrant := func(ctx context.Context, grant auth.ManagerGrant) error {
		return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, "DELETE FROM manager_grants WHERE employee_id=$1 AND grant_code=$2", employee.ID, grant); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, "UPDATE employees SET manager_grants_version=manager_grants_version+1 WHERE id=$1", employee.ID)
			return err
		})
	}
	handlers := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.TLS == nil || r.TLS.Version != tls.VersionTLS13 || len(r.TLS.VerifiedChains) == 0 ||
			len(r.TLS.PeerCertificates[0].URIs) != 1 ||
			r.TLS.PeerCertificates[0].URIs[0].String() != "spiffe://amocrm-pro/manager-bff" {
			t.Error("Platform did not receive the Manager BFF mTLS identity")
			http.Error(w, "bad fixture identity", http.StatusUnauthorized)
			return
		}
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" ||
			r.Header.Get("X-Forwarded-Host") != "" || r.Header.Get("Origin") != "" ||
			r.Header.Get("X-Requested-With") != "" || len(r.Header.Values("X-Platform-Actor")) != 1 {
			t.Error("browser headers reached Platform")
		}
		route, params, err := platformRouter.FindRoute(r)
		if err != nil {
			t.Errorf("generated request route: %v", err)
			http.Error(w, "unexpected fixture route", http.StatusBadRequest)
			return
		}
		input := &openapi3filter.RequestValidationInput{
			Request: r, Route: route, PathParams: params,
			Options: &openapi3filter.Options{AuthenticationFunc: openapi3filter.NoopAuthenticationFunc},
		}
		if err := openapi3filter.ValidateRequest(r.Context(), input); err != nil {
			t.Errorf("generated request breaks Platform contract: %v", err)
		}
		rawActor, err := base64.RawURLEncoding.DecodeString(r.Header.Get("X-Platform-Actor"))
		if err != nil {
			t.Error(err)
		}
		var actorJSON any
		var actor wire.ManagerContext
		if err := json.Unmarshal(rawActor, &actorJSON); err != nil {
			t.Error(err)
		}
		if err := actorSchema.VisitJSON(actorJSON, openapi3.EnableFormatValidation()); err != nil {
			t.Errorf("generated actor breaks Platform contract: %v", err)
		}
		if err := json.Unmarshal(rawActor, &actor); err != nil {
			t.Error(err)
		}
		if actor.Actor.SubjectId != employee.ID || actor.Actor.SessionId != principal.SessionID ||
			actor.TraceId != nil || actor.RequestId == uuid.Nil ||
			!actor.DeadlineAt.After(actor.IssuedAt) || actor.DeadlineAt.Sub(actor.IssuedAt) > 30*time.Second {
			t.Error("unexpected Platform actor subject, scope or timing")
		}
		if actor.Actor.GrantsVersion != grantVersion || !slices.IsSorted(actor.Actor.Grants) ||
			(grantVersion >= 3 && slices.Contains(actor.Actor.Grants, wire.Grant(auth.GrantCatalogManage))) ||
			(grantVersion >= 4 && slices.Contains(actor.Actor.Grants, wire.Grant(auth.GrantClientsWrite))) {
			t.Errorf("stale or unordered grants: version %d, grants %v", actor.Actor.GrantsVersion, actor.Actor.Grants)
		}
		respond := func(status int, value any) {
			data, err := json.Marshal(value)
			if err != nil {
				t.Error(err)
			}
			w.Header().Set("Content-Type", "application/json")
			response := (&openapi3filter.ResponseValidationInput{RequestValidationInput: input, Status: status, Header: w.Header()}).SetBodyBytes(data)
			if err := openapi3filter.ValidateResponse(r.Context(), response); err != nil {
				t.Errorf("fixture response breaks Platform contract: %v", err)
			}
			w.WriteHeader(status)
			_, _ = w.Write(data)
		}
		switch route.Operation.OperationID {
		case "retryInstallationDeal":
			mutations++
			if actor.CommandId == nil || r.Header.Get("Idempotency-Key") != meta.IdempotencyKey.String() ||
				r.Header.Get("If-Match") != `"42"` || params["id"] != meta.TargetID.String() {
				t.Error("command dropped an identity or its precondition")
				return
			}
			commandID = *actor.CommandId
			var admitted, auditCommitted bool
			err := pool.QueryRow(r.Context(), `
				SELECT EXISTS(SELECT 1 FROM manager_command_intents WHERE id = $1 AND employee_id = $2 AND session_id = $3),
				       EXISTS(SELECT 1 FROM admin_audit_log WHERE action = 'manager.command.admitted' AND metadata->>'command_id' = $1::text)`,
				commandID, employee.ID, principal.SessionID).Scan(&admitted, &auditCommitted)
			if err != nil || !admitted || !auditCommitted {
				t.Errorf("intent/audit were not committed before the effect: %t %t %v", admitted, auditCommitted, err)
			}
			effects++
			close(effectReady)
			select {
			case <-releaseEffect:
			case <-r.Context().Done():
			}
			panic(http.ErrAbortHandler)
		case "listInstallations":
			listRequests++
			if actor.CommandId != nil {
				t.Error("list sent a mutating actor envelope")
			}
			query := r.URL.Query()
			switch query.Get("cursor") {
			case "expired":
				respond(http.StatusBadRequest, errorBody("invalid_cursor"))
				return
			}
			switch query.Get("q") {
			case "broad":
				respond(http.StatusBadRequest, errorBody("query_too_broad"))
				return
			case "limited":
				w.Header().Set("Retry-After", "23")
				respond(http.StatusTooManyRequests, errorBody("rate_limited"))
				return
			case "unavailable":
				w.Header().Set("Retry-After", "7")
				respond(http.StatusServiceUnavailable, errorBody("dependency_unavailable"))
				return
			case "malformed":
				row := installation()
				delete(row["access"].(map[string]any), "active")
				httpx.WriteJSON(w, http.StatusOK, map[string]any{
					"items": []any{row}, "next_cursor": nil, "snapshot_at": now, "query_hash": strings.Repeat("2", 64),
					"summary": map[string]int{"total": 1, "reviewed": 1, "unreviewed": 0},
				})
				return
			case "remove-read":
				if err := removeFixtureGrant(r.Context(), auth.GrantClientsRead); err != nil {
					t.Error(err)
				}
				grantVersion++
				respond(http.StatusOK, map[string]any{
					"items": []any{installation()}, "next_cursor": nil, "snapshot_at": now, "query_hash": strings.Repeat("2", 64),
					"summary": map[string]int{"total": 1, "reviewed": 1, "unreviewed": 0},
				})
				return
			case "empty":
				respond(http.StatusOK, map[string]any{
					"items": []any{}, "next_cursor": nil, "snapshot_at": now, "query_hash": strings.Repeat("2", 64),
					"summary": map[string]int{"total": 0, "reviewed": 0, "unreviewed": 0},
				})
				return
			}
			if !reflect.DeepEqual(query, wantFilters) {
				t.Errorf("Platform filters = %v, want %v", query, wantFilters)
			}
			respond(http.StatusOK, map[string]any{
				"items": []any{installation()}, "next_cursor": opaqueCursor,
				"snapshot_at": now, "query_hash": strings.Repeat("1", 64),
				"summary": map[string]int{"total": 20, "reviewed": 20, "unreviewed": 0},
			})
		case "setInstallationReview":
			if r.Header.Get("Idempotency-Key") == unavailableKey.String() {
				w.Header().Set("Retry-After", "8")
				respond(http.StatusServiceUnavailable, errorBody("dependency_unavailable"))
				return
			}
			if r.Header.Get("Idempotency-Key") == staleKey.String() {
				problem := errorBody("version_conflict")
				problem.Error.CurrentVersion = new(43)
				respond(http.StatusConflict, problem)
				return
			}
			reviewRequests++
			var payload wire.SetInstallationReviewJSONRequestBody
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || !payload.Reviewed ||
				payload.Reason == nil || *payload.Reason != reason || actor.CommandId == nil ||
				r.Header.Get("Idempotency-Key") != reviewMeta.IdempotencyKey.String() ||
				r.Header.Get("If-Match") != `"42"` || params["id"] != reviewMeta.TargetID.String() {
				t.Error("sync replay lost original command identity, precondition or body")
				return
			}
			if reviewID == uuid.Nil {
				reviewID = *actor.CommandId
				reviewEffects++
				panic(http.ErrAbortHandler)
			}
			if *actor.CommandId != reviewID {
				t.Error("sync replay generated a second ID")
				return
			}
			w.Header().Set("ETag", `"43"`)
			respond(http.StatusOK, installation())
		case "getCommandReceipt":
			if reviewID != uuid.Nil && params["id"] == reviewID.String() {
				if actor.CommandId != nil {
					t.Error("sync receipt read sent a mutating envelope")
				}
				respond(http.StatusOK, wire.CommandReceipt{Id: reviewID, Kind: "installation.review", State: wire.CommandReceiptStateCompleted})
				return
			}
			receipts++
			if actor.CommandId != nil || params["id"] != commandID.String() {
				t.Error("receipt reconstructed a different command")
			}
			switch receiptStatus {
			case http.StatusNotFound:
				respond(http.StatusNotFound, errorBody("not_found"))
			case http.StatusForbidden:
				respond(http.StatusForbidden, errorBody("forbidden"))
			case http.StatusTooManyRequests:
				w.Header().Set("Retry-After", "21")
				respond(http.StatusTooManyRequests, errorBody("rate_limited"))
			default:
				respond(http.StatusOK, wire.CommandReceipt{Id: commandID, Kind: "installation.crm_deal.retry",
					State: wire.CommandReceiptStateAccepted, OperationId: &commandID})
			}
		case "getOperation":
			operations++
			if actor.CommandId != nil || params["id"] != commandID.String() {
				t.Error("operation lookup reconstructed a different command")
			}
			respond(http.StatusOK, operation())
			workerObserved <- struct{}{}
		default:
			t.Errorf("unexpected Platform operation %s", route.Operation.OperationID)
		}
	})
	endpoint, clientConfig := startManagerPlatformPeer(t, handlers)
	clientConfig.URL = endpoint
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	firstClient, err := managerplatform.NewClient(clientConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer firstClient.Close()
	first := managerplatform.NewService(pool, 2*time.Second, audits, sessions, firstClient, logger)
	type dispatchResult struct {
		result managerplatform.Result
		err    error
	}
	lostResponse := make(chan dispatchResult, 1)
	go func() {
		result, err := first.RetryInstallationDeal(managerCtx, meta, body)
		lostResponse <- dispatchResult{result, err}
	}()
	select {
	case <-effectReady:
	case <-time.After(4 * time.Second):
		t.Fatal("Platform did not reach the first effect")
	}
	concurrent, err := first.RetryInstallationDeal(managerCtx, meta, body)
	if err != nil || concurrent.State != managerplatform.UnknownOutcome {
		t.Fatalf("concurrent browser replay = %+v, %v", concurrent, err)
	}
	release()
	lost := <-lostResponse
	dispatched := lost.result
	if lost.err != nil || dispatched.State != managerplatform.UnknownOutcome ||
		dispatched.ID == uuid.Nil || dispatched.ID != concurrent.ID {
		t.Fatalf("lost response = %+v, %v; concurrent = %+v", dispatched, lost.err, concurrent)
	}
	firstClient.Close()

	secondClient, err := managerplatform.NewClient(clientConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer secondClient.Close()
	restartedSessions := auth.NewManagerService(pool, 8*time.Second, time.Hour, time.Hour, true)
	restarted := managerplatform.NewService(pool, 2*time.Second, audits, restartedSessions, secondClient, logger)
	if _, err := pool.Exec(ctx, "UPDATE manager_command_intents SET next_check_at=now() WHERE id=$1", dispatched.ID); err != nil {
		t.Fatal(err)
	}
	workerCtx, stopWorker := context.WithCancel(ctx)
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		restarted.Reconcile(workerCtx)
	}()
	select {
	case <-workerObserved:
	case <-time.After(3 * time.Second):
		t.Error("restarted worker did not look up the original operation")
	}
	stopWorker()
	<-stopped

	removeGrant := func(grant auth.ManagerGrant) {
		t.Helper()
		if err := removeFixtureGrant(ctx, grant); err != nil {
			t.Fatal(err)
		}
		mu.Lock()
		grantVersion++
		mu.Unlock()
	}
	removeGrant(auth.GrantCatalogManage)
	router := New(Dependencies{
		Employees: store, Sessions: core, ManagerSessions: restartedSessions, ManagerPlatform: restarted,
		Audit: audits, Limiter: auth.NewLimiter(50), Logger: logger,
		PublicOrigin: adminOrigin, ManagerOrigin: managerOrigin,
	})
	browserSpec := loadManagerPlatformTestSpec(t, "openapi.yaml")
	browserOperation := browserSpec.Paths.Find("/api/v1/managers/operations/{id}").Get
	request := func(host, cookie string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, host+"/api/v1/managers/operations/"+dispatched.ID.String(), nil)
		req.Header.Set("X-Platform-Actor", "browser-forged")
		req.Header.Set("Authorization", "Bearer never-forwarded")
		req.Header.Set("X-Forwarded-Host", "managers.example.invalid")
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: auth.ManagerCookieName, Value: cookie})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != want {
			t.Fatalf("browser operation response = %d, want %d: %s", response.Code, want, response.Body)
		}
		if strings.Contains(response.Body.String(), "upstream") || strings.Contains(response.Body.String(), "browser-forged") {
			t.Fatal("browser received private peer details")
		}
		if want == http.StatusOK {
			var document any
			decodeBody(t, response, &document)
			if err := browserOperation.Responses.Status(want).Value.Content["application/json"].Schema.Value.VisitJSON(document, openapi3.EnableFormatValidation()); err != nil {
				t.Fatalf("browser operation contract: %v", err)
			}
		}
		return response
	}
	request(adminOrigin, token, http.StatusNotFound)
	request(managerOrigin, "", http.StatusUnauthorized)
	request(managerOrigin, coreToken, http.StatusUnauthorized)
	request(managerOrigin, otherToken, http.StatusNotFound)
	response := request(managerOrigin, token, http.StatusOK)
	var result managerOperationResponse
	decodeBody(t, response, &result)
	if result.ID != dispatched.ID || result.Operation == nil || result.Operation.State != string(wire.OperationStateSucceeded) {
		t.Fatalf("recovered operation mismatch: %+v", result)
	}

	replayed, err := restarted.RetryInstallationDeal(managerCtx, meta, body)
	if err != nil || replayed.ID != dispatched.ID || replayed.Operation == nil {
		t.Fatalf("identical replay = %+v, %v", replayed, err)
	}
	if _, err := restarted.RetryInstallationDeal(managerCtx, meta, wire.RetryInstallationDealJSONRequestBody{Reason: "changed"}); !errors.Is(err, managerplatform.ErrConflict) {
		t.Fatalf("changed command = %v", err)
	}
	setReceipt := func(status int) { mu.Lock(); receiptStatus = status; mu.Unlock() }
	setReceipt(http.StatusNotFound)
	response = request(managerOrigin, token, http.StatusOK)
	result = managerOperationResponse{}
	decodeBody(t, response, &result)
	if result.ID != dispatched.ID || result.State != managerplatform.UnknownOutcome || result.Operation != nil {
		t.Fatalf("receipt 404 was treated as a known outcome: %+v", result)
	}
	setReceipt(http.StatusForbidden)
	request(managerOrigin, token, http.StatusForbidden)
	if _, err := restarted.RetryInstallationDeal(managerCtx, meta, body); err == nil {
		t.Fatal("receipt denial allowed redispatch")
	}
	setReceipt(http.StatusTooManyRequests)
	var limited *managerplatform.PeerError
	if _, err := restarted.RetryInstallationDeal(managerCtx, meta, body); !errors.As(err, &limited) || limited.Status != http.StatusTooManyRequests {
		t.Fatalf("rate-limited receipt replay = %v", err)
	}
	var retrySeconds float64
	if err := pool.QueryRow(ctx, `
		SELECT extract(epoch from (next_check_at - updated_at))::float8
		FROM manager_command_intents WHERE id = $1`, dispatched.ID).Scan(&retrySeconds); err != nil ||
		retrySeconds != 21 {
		t.Fatalf("worker retry follows Platform Retry-After: %f, %v", retrySeconds, err)
	}
	if retry := request(managerOrigin, token, http.StatusTooManyRequests).Header().Get("Retry-After"); retry != "21" {
		t.Fatalf("Retry-After = %q", retry)
	}
	setReceipt(http.StatusOK)
	installationsPath := "/api/v1/managers/installations"
	reviewPath := installationsPath + "/" + reviewMeta.TargetID.String() + "/review"
	listAPI := browserSpec.Paths.Find(installationsPath).Get
	reviewAPI := browserSpec.Paths.Find(installationsPath + "/{id}/review").Put
	browserRequest := func(router http.Handler, method, path, cookie, origin, media, key, match, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, managerOrigin+path, strings.NewReader(body))
		request.Header.Set("X-Platform-Actor", "browser-forged")
		if cookie != "" {
			request.AddCookie(&http.Cookie{Name: auth.ManagerCookieName, Value: cookie})
		}
		if method == http.MethodPut {
			request.Header.Set("X-Requested-With", "admin-ui")
			request.Header.Set("Origin", origin)
			request.Header.Set("Content-Type", media)
			request.Header.Set("Idempotency-Key", key)
			request.Header.Set("If-Match", match)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != want || strings.Contains(response.Body.String(), "private upstream detail") ||
			response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s = %d, want %d with safe no-store response: %s", method, path, response.Code, want, response.Body)
		}
		api := listAPI
		if method == http.MethodPut {
			api = reviewAPI
		}
		if (method == http.MethodGet && strings.HasPrefix(path, installationsPath)) || method == http.MethodPut {
			var document any
			decodeBody(t, response, &document)
			if err := api.Responses.Status(want).Value.Content["application/json"].Schema.Value.VisitJSON(document, openapi3.EnableFormatValidation()); err != nil {
				t.Fatalf("browser response contract: %v", err)
			}
		}
		return response
	}
	list := func(query string, want int) *httptest.ResponseRecorder {
		t.Helper()
		return browserRequest(router, http.MethodGet, installationsPath+query, token, "", "", "", "", "", want)
	}
	assertDetails := func(response *httptest.ResponseRecorder, code string, version int) {
		t.Helper()
		var body struct {
			Error struct {
				Details struct {
					Code    string `json:"code"`
					Version int    `json:"current_version"`
				}
			}
		}
		decodeBody(t, response, &body)
		if body.Error.Details.Code != code || body.Error.Details.Version != version {
			t.Fatalf("error details = %+v, want %q %d", body.Error.Details, code, version)
		}
	}
	browserRequest(router, http.MethodGet, installationsPath, "", "", "", "", "", "", http.StatusUnauthorized)
	browserRequest(router, http.MethodGet, installationsPath, coreToken, "", "", "", "", "", http.StatusUnauthorized)
	for _, query := range []string{"?unsupported=1", "?review=reviewed&review=unreviewed", "?limit=01", "?activation=unknown", "?from=2026-12-01&to=2026-11-30", "?q=%00", "?q=%"} {
		list(query, http.StatusBadRequest)
	}
	assertDetails(list("?cursor=expired", http.StatusBadRequest), "invalid_cursor", 0)
	assertDetails(list("?q=broad", http.StatusBadRequest), "query_too_broad", 0)
	if after := list("?q=limited", http.StatusTooManyRequests).Header().Get("Retry-After"); after != "23" {
		t.Fatalf("list 429 Retry-After = %q", after)
	}
	if after := list("?q=unavailable", http.StatusServiceUnavailable).Header().Get("Retry-After"); after != "7" {
		t.Fatalf("list 503 Retry-After = %q", after)
	}
	list("?q=malformed", http.StatusServiceUnavailable)
	var page managerInstallationListDTO
	decodeBody(t, list("?q=empty", http.StatusOK), &page)
	if page.Items == nil || len(page.Items) != 0 || page.NextCursor != nil || page.Summary.Total != 0 {
		t.Fatalf("empty snapshot = %+v", page)
	}
	decodeBody(t, list("?"+wantFilters.Encode(), http.StatusOK), &page)
	if len(page.Items) != 1 || page.Items[0].AmoAccountID != "9223372036854775807" ||
		page.Items[0].Access.ValidUntil != nil || page.Items[0].RemovedAt != nil || page.Summary.Total != 20 ||
		page.NextCursor == nil || *page.NextCursor != opaqueCursor || !page.SnapshotAt.Equal(now) ||
		len(page.Sources) != 1 || page.Sources[0].Backend != "platform" ||
		page.Sources[0].ObservedAt == nil || !page.Sources[0].ObservedAt.Equal(now) {
		t.Fatalf("filtered live snapshot = %+v", page)
	}

	bodyJSON := `{"reviewed":true,"reason":"fixture review"}`
	review := func(router http.Handler, cookie, origin, key, match, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		return browserRequest(router, http.MethodPut, reviewPath, cookie, origin, "application/json", key, match, body, want)
	}
	key := reviewMeta.IdempotencyKey.String()
	review(router, "", managerOrigin, key, `"42"`, bodyJSON, http.StatusUnauthorized)
	review(router, otherToken, managerOrigin, key, `"42"`, bodyJSON, http.StatusForbidden)
	review(router, token, adminOrigin, key, `"42"`, bodyJSON, http.StatusForbidden)
	review(router, token, managerOrigin, key, `W/"42"`, bodyJSON, http.StatusBadRequest)
	review(router, token, managerOrigin, key, `"9007199254740992"`, bodyJSON, http.StatusBadRequest)
	for _, body := range []string{`{}`, `{"reviewed":null}`, `{"Reviewed":true}`, `{"reviewed":true,"reviewed":false}`, `{"reviewed":true,"reason":null}`, `{"reviewed":true,"actor":"forged"}`} {
		review(router, token, managerOrigin, key, `"42"`, body, http.StatusBadRequest)
	}
	assertDetails(review(router, token, managerOrigin, staleKey.String(), `"42"`, bodyJSON, http.StatusConflict), "version_conflict", 43)
	if retry := review(router, token, managerOrigin, unavailableKey.String(), `"42"`, bodyJSON, http.StatusAccepted); retry.Header().Get("Retry-After") != "8" {
		t.Fatalf("unknown review Retry-After = %q", retry.Header().Get("Retry-After"))
	}
	lostReview := review(router, token, managerOrigin, key, `"42"`, bodyJSON, http.StatusAccepted)
	var syncLost managerOperationResponse
	decodeBody(t, lostReview, &syncLost)
	location := lostReview.Header().Get("Location")
	if syncLost.ID == uuid.Nil || syncLost.State != managerplatform.UnknownOutcome || location != "/api/v1/managers/operations/"+syncLost.ID.String() {
		t.Fatalf("unknown review = %+v at %q", syncLost, location)
	}
	thirdClient, err := managerplatform.NewClient(clientConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer thirdClient.Close()
	third := managerplatform.NewService(pool, 2*time.Second, audits, restartedSessions, thirdClient, logger)
	restartedRouter := New(Dependencies{
		Employees: store, Sessions: core, ManagerSessions: restartedSessions, ManagerPlatform: third,
		Audit: audits, Limiter: auth.NewLimiter(50), Logger: logger,
		PublicOrigin: adminOrigin, ManagerOrigin: managerOrigin,
	})
	pollReview := func(cookie string, want int) *httptest.ResponseRecorder {
		t.Helper()
		return browserRequest(restartedRouter, http.MethodGet, location, cookie, "", "", "", "", "", want)
	}
	pollReview(otherToken, http.StatusNotFound)
	var syncStatus managerOperationResponse
	decodeBody(t, pollReview(token, http.StatusOK), &syncStatus)
	if syncStatus.ID != syncLost.ID || syncStatus.State != managerplatform.ReceiptDone || syncStatus.Operation != nil {
		t.Fatalf("sync receipt after restart = %+v", syncStatus)
	}
	assertDetails(review(restartedRouter, token, managerOrigin, key, `"42"`, `{"reviewed":false}`, http.StatusConflict), "idempotency_conflict", 0)
	exact := review(restartedRouter, token, managerOrigin, key, `"42"`, bodyJSON, http.StatusOK)
	var reviewed managerInstallationDTO
	decodeBody(t, exact, &reviewed)
	if reviewed.ID != reviewMeta.TargetID || reviewed.Version != 43 || !reviewed.Review.Reviewed ||
		reviewed.RemovedAt != nil || exact.Header().Get("ETag") != `"43"` {
		t.Fatalf("exact review response = %+v with ETag %q", reviewed, exact.Header().Get("ETag"))
	}
	removeGrant(auth.GrantClientsWrite)
	pollReview(token, http.StatusForbidden)
	setReceipt(http.StatusForbidden)
	request(managerOrigin, token, http.StatusOK)
	if _, err := third.SetInstallationReview(managerCtx, reviewMeta, reviewBody); !errors.Is(err, managerplatform.ErrForbidden) {
		t.Fatalf("manager could write after removal of the live write grant: %v", err)
	}
	list("?q=remove-read", http.StatusForbidden)
	list("", http.StatusForbidden)
	if err := restartedSessions.Revoke(ctx, principal.SessionID, auth.ReasonAdmin); err != nil {
		t.Fatal(err)
	}
	request(managerOrigin, token, http.StatusUnauthorized)
	if _, err := restarted.RetryInstallationDeal(managerCtx, meta, body); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("revoked session could resubmit: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if mutations != 1 || effects != 1 || receipts < 5 || operations != 4 ||
		reviewRequests != 2 || reviewEffects != 1 || listRequests != 8 {
		t.Fatalf("boundary interactions: async mutations=%d effects=%d receipts=%d operations=%d; sync requests=%d effects=%d; list requests=%d",
			mutations, effects, receipts, operations, reviewRequests, reviewEffects, listRequests)
	}
}

func loadManagerPlatformTestSpec(t *testing.T, file string) *openapi3.T {
	t.Helper()
	spec, err := openapi3.NewLoader().LoadFromFile(filepath.Join("..", "..", "api", file))
	if err != nil {
		t.Fatal(err)
	}
	if err := spec.Validate(t.Context()); err != nil {
		t.Fatal(err)
	}
	return spec
}

func startManagerPlatformPeer(t *testing.T, handler http.Handler) (string, managerplatform.ClientConfig) {
	t.Helper()
	now := time.Now().UTC()
	root := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "A02 fixture CA"},
		NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}
	rootPublic, rootPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	rootDER, err := x509.CreateCertificate(rand.Reader, root, root, rootPublic, rootPrivate)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	write := func(name, kind string, data []byte) string {
		t.Helper()
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: kind, Bytes: data}), 0o600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	leaf := func(serial int64, use x509.ExtKeyUsage, dns []string, uri string) ([]byte, []byte) {
		t.Helper()
		public, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		template := &x509.Certificate{SerialNumber: big.NewInt(serial), NotBefore: root.NotBefore, NotAfter: root.NotAfter,
			DNSNames: dns, ExtKeyUsage: []x509.ExtKeyUsage{use}, KeyUsage: x509.KeyUsageDigitalSignature}
		if uri != "" {
			identity, err := url.Parse(uri)
			if err != nil {
				t.Fatal(err)
			}
			template.URIs = []*url.URL{identity}
		}
		der, err := x509.CreateCertificate(rand.Reader, template, root, public, rootPrivate)
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			t.Fatal(err)
		}
		return der, encoded
	}
	serverDER, serverKey := leaf(2, x509.ExtKeyUsageServerAuth, []string{"localhost"}, "")
	clientDER, clientKey := leaf(3, x509.ExtKeyUsageClientAuth, nil, "spiffe://amocrm-pro/manager-bff")
	wrongDER, wrongKey := leaf(4, x509.ExtKeyUsageClientAuth, nil, "spiffe://amocrm-pro/core")
	server, err := tls.X509KeyPair(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: serverDER}),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: serverKey}))
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: rootDER}))
	peer := httptest.NewUnstartedServer(handler)
	peer.Config.ErrorLog = slog.NewLogLogger(slog.NewTextHandler(io.Discard, nil), slog.LevelError)
	peer.TLS = &tls.Config{
		MinVersion: tls.VersionTLS13, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: roots,
		Certificates: []tls.Certificate{server},
	}
	peer.StartTLS()
	t.Cleanup(peer.Close)

	config := managerplatform.ClientConfig{
		URL: strings.Replace(peer.URL, "127.0.0.1", "localhost", 1), Timeout: 5 * time.Second,
		CAFile:   write("ca.pem", "CERTIFICATE", rootDER),
		CertFile: write("bff.pem", "CERTIFICATE", clientDER), KeyFile: write("bff.key", "PRIVATE KEY", clientKey),
	}
	wrong := config
	wrong.CertFile, wrong.KeyFile = write("core.pem", "CERTIFICATE", wrongDER), write("core.key", "PRIVATE KEY", wrongKey)
	if client, err := managerplatform.NewClient(wrong); err == nil {
		client.Close()
		t.Fatal("accepted a Core rather than Manager BFF SPIFFE identity")
	}
	return config.URL, config
}
