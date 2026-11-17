package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/managerplatform"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestManagerClientWorkspaceAcrossOwnerBoundary(t *testing.T) {
	const origin = "https://managers.example.invalid"
	const browser = "/api/v1/managers"
	const owner = "/internal/platform/v1/managers"
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := t.Context()
	const dbTimeout = 8 * time.Second
	employeesStore := employees.NewStore(pool, dbTimeout)
	audits := audit.NewStore(pool, dbTimeout)
	sessions := auth.NewManagerService(pool, dbTimeout, time.Hour, time.Hour, true)
	core := auth.NewService(pool, dbTimeout, time.Hour, time.Hour, true)
	writer := createEmployee(t, ctx, employeesStore, "clients-writer@example.invalid", "Fixture Writer", rbac.RoleViewer)
	reader := createEmployee(t, ctx, employeesStore, "clients-reader@example.invalid", "Fixture Reader", rbac.RoleViewer)
	if err := employees.NewAccess(employeesStore, core, audits).BootstrapManager(ctx, writer.Email, audit.Event{}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO manager_grants(employee_id,grant_code) VALUES($1,'clients.read')", reader.ID); err != nil {
		t.Fatal(err)
	}
	login := func(email string) string {
		t.Helper()
		token, _, err := sessions.Login(ctx, email, testPassword, "", "")
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	writerCookie, readerCookie := login(writer.Email), login(reader.Email)
	accountID, foreignAccountID := uuid.New(), uuid.New()
	profileKey, staleKey, refreshKey := uuid.New(), uuid.New(), uuid.New()
	now := time.Now().UTC().Round(time.Second)
	var mu sync.Mutex
	var profileID, refreshID uuid.UUID
	var profileAttempts, refreshAttempts, readCalls int
	var revokeReadOnPoll bool
	const errorSecret = "private upstream diagnostic"
	problem := func(w http.ResponseWriter, status int, code string, version int) {
		errorBody := map[string]any{"code": code, "message": errorSecret, "request_id": uuid.New(), "retryable": false}
		if version > 0 {
			errorBody["current_version"] = version
		}
		httpx.WriteJSON(w, status, map[string]any{"error": errorBody})
	}
	summary := func() map[string]any {
		return map[string]any{
			"account_id": accountID, "amo_account_id": "9007199254740993", "current_domain": "fixture.amocrm.test",
			"domain_aliases": nil, "display_name": "Fixture account", "classification": nil, "active_products_count": 1,
			"version": 2, "license": map[string]any{"state": "unsupported", "source": "amo"},
			"active_users": map[string]any{"state": "unknown", "source": "amo"},
		}
	}
	detail := func() map[string]any {
		data := summary()
		data["note"], data["region"], data["time_zone"] = "saved", nil, nil
		data["amostart"] = map[string]any{"state": "unsupported", "source": "amo"}
		data["capabilities"] = []any{}
		return data
	}
	operation := func() map[string]any {
		return map[string]any{"id": refreshID, "kind": "account.refresh", "state": "accepted",
			"target": map[string]any{"kind": "account", "id": accountID}, "created_at": now, "updated_at": now,
			"error": map[string]any{"error": map[string]any{"code": "internal", "message": errorSecret, "request_id": uuid.New(), "retryable": false}}}
	}
	_, cfg := startManagerPlatformPeer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		raw, err := base64.RawURLEncoding.DecodeString(r.Header.Get("X-Platform-Actor"))
		var actor wire.ManagerContext
		if err != nil || json.Unmarshal(raw, &actor) != nil || actor.Actor.SessionId == uuid.Nil ||
			!actor.DeadlineAt.After(actor.IssuedAt) || r.TLS == nil || len(r.TLS.PeerCertificates) != 1 ||
			r.TLS.PeerCertificates[0].URIs[0].String() != "spiffe://amocrm-pro/manager-bff" {
			t.Error("request lacked a certified bounded manager actor")
			return
		}
		path := strings.TrimPrefix(r.URL.Path, owner)
		if strings.Contains(path, foreignAccountID.String()) {
			problem(w, http.StatusNotFound, "resource_not_found", 0)
			return
		}
		switch path {
		case "/accounts", "/accounts/search":
			readCalls++
			if actor.CommandId != nil || r.Header.Get("Idempotency-Key") != "" || actor.Actor.SubjectId != reader.ID {
				t.Error("public read sent an intent or wrong subject")
			}
			if q := r.URL.Query().Get("q"); q == "grants-version" {
				if _, err := pool.Exec(r.Context(), "UPDATE employees SET manager_grants_version=manager_grants_version+1 WHERE id=$1", reader.ID); err != nil {
					t.Error(err)
				}
			} else if q != "account" || r.URL.Query().Get("limit") != "1" || len(r.URL.Query()["classification"]) != 2 {
				t.Errorf("dropped confirmed filters: %s", r.URL.RawQuery)
			}
			httpx.WriteJSON(w, http.StatusOK, map[string]any{
				"items": []any{summary()}, "next_cursor": "sample-cursor", "snapshot_at": now,
				"query_hash": strings.Repeat("d", 64), "summary": map[string]int{"total": 2},
			})
		case "/accounts/" + accountID.String() + "/crm-users":
			if r.URL.Query().Get("active") == "true" {
				httpx.WriteJSON(w, http.StatusOK, map[string]any{"state": "stale", "source": "amo", "observed_at": now.Add(-time.Hour),
					"fresh_until": now.Add(-time.Minute), "value": []any{map[string]any{"id": "99", "name": "Fixture Staff", "is_active": true, "is_admin": false}}})
			} else {
				httpx.WriteJSON(w, http.StatusOK, map[string]any{"state": "stale", "source": "amo", "observed_at": now.Add(-time.Hour),
					"fresh_until": now.Add(-time.Minute), "value": []any{map[string]any{"id": "99", "name": "Fixture Staff", "is_active": true, "is_admin": false, "email": "fixture@example.invalid"}}})
			}
		case "/accounts/" + accountID.String() + "/profile":
			if actor.Actor.SubjectId != writer.ID || actor.CommandId == nil || r.Header.Get("If-Match") != "\"1\"" {
				t.Error("profile command had the wrong subject or precondition")
				return
			}
			if r.Header.Get("Idempotency-Key") == staleKey.String() {
				problem(w, http.StatusConflict, "version_conflict", 2)
				return
			}
			rawBody, err := io.ReadAll(r.Body)
			if err != nil || string(rawBody) != `{"note":null,"reason":"fixture"}` || r.Header.Get("Idempotency-Key") != profileKey.String() {
				t.Errorf("profile dispatch changed body or key: %v", err)
				return
			}
			profileAttempts++
			if profileAttempts == 1 {
				profileID = *actor.CommandId
				var count int
				err := pool.QueryRow(r.Context(), "SELECT count(*) FROM manager_command_intents WHERE id=$1 AND kind='account.profile' AND expected_version=1", profileID).Scan(&count)
				if err != nil || count != 1 {
					t.Errorf("missing durable intent at dispatch: %d, %v", count, err)
				}
				panic(http.ErrAbortHandler)
			}
			if *actor.CommandId != profileID {
				t.Error("repeat changed command ID")
			}
			w.Header().Set("ETag", "\"2\"")
			httpx.WriteJSON(w, http.StatusOK, detail())
		case "/accounts/" + accountID.String() + "/refresh":
			if actor.CommandId == nil || r.Header.Get("Idempotency-Key") != refreshKey.String() || r.Header.Get("If-Match") != "" {
				t.Error("refresh lost one part of its identity")
				return
			}
			refreshAttempts++
			refreshID = *actor.CommandId
			w.Header().Set("Location", owner+"/operations/"+refreshID.String())
			httpx.WriteJSON(w, http.StatusAccepted, operation())
		case "/commands/" + profileID.String():
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"id": profileID, "kind": "account.profile", "state": "completed"})
		case "/commands/" + refreshID.String():
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"id": refreshID, "kind": "account.refresh", "state": "accepted", "operation_id": refreshID})
		case "/operations/" + refreshID.String():
			if revokeReadOnPoll {
				revokeReadOnPoll = false
				if _, err := pool.Exec(r.Context(), `DELETE FROM manager_grants
					WHERE employee_id=$1 AND grant_code='clients.read'`, writer.ID); err != nil {
					t.Error(err)
				}
			}
			httpx.WriteJSON(w, http.StatusOK, operation())
		case "/portrait-template":
			if actor.CommandId == nil || r.Header.Get("If-Match") != "\"1\"" {
				t.Error("configuration command missing version")
				return
			}
			w.Header().Set("ETag", "\"2\"")
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"version": 2, "topics": []any{}})
		default:
			t.Errorf("unexpected Platform target %s", path)
			problem(w, http.StatusNotFound, "resource_not_found", 0)
		}
	}))
	client, err := managerplatform.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	service := managerplatform.NewService(pool, dbTimeout, audits, sessions, client, logger)
	router := New(Dependencies{Employees: employeesStore, Sessions: core, ManagerSessions: sessions, ManagerPlatform: service,
		Audit: audits, Limiter: auth.NewLimiter(50), Logger: logger, PublicOrigin: "https://admin.example.invalid", ManagerOrigin: origin})
	call := func(method, path, cookie, body string, key uuid.UUID, etag string, csrf bool, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, origin+browser+path, strings.NewReader(body))
		req.AddCookie(&http.Cookie{Name: auth.ManagerCookieName, Value: cookie})
		req.Header.Set("X-Platform-Actor", "forged browser actor")
		if csrf {
			req.Header.Set("X-Requested-With", "admin-ui")
			req.Header.Set("Origin", origin)
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if key != uuid.Nil {
			req.Header.Set("Idempotency-Key", key.String())
		}
		if etag != "" {
			req.Header.Set("If-Match", etag)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != want || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s got %d want %d; %s", method, path, res.Code, want, res.Body.String())
		}
		if strings.Contains(res.Body.String(), errorSecret) {
			t.Fatal("owner diagnostic escaped into browser response")
		}
		return res
	}
	const filters = "?q=account&limit=1&classification=one&classification=two"
	browserList := call(http.MethodGet, "/accounts"+filters, readerCookie, "", uuid.Nil, "", false, http.StatusOK)
	if !strings.Contains(browserList.Body.String(), `"summary":{"total":2}`) || !strings.Contains(browserList.Body.String(), `"backend":"platform"`) {
		t.Fatalf("account list lost authoritative totals or source: %s", browserList.Body.String())
	}
	searchBody := `{"portrait_filter":{"condition":{"field_id":"` + uuid.NewString() + `","op":"exists"}}}`
	call(http.MethodPost, "/accounts/search"+filters, readerCookie, searchBody, uuid.Nil, "", false, http.StatusForbidden)
	call(http.MethodPost, "/accounts/search"+filters, readerCookie, searchBody, uuid.Nil, "", true, http.StatusOK)
	var intents int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM manager_command_intents").Scan(&intents); err != nil || intents != 0 {
		t.Fatalf("read search created an intent: %d %v", intents, err)
	}
	call(http.MethodGet, "/accounts/"+foreignAccountID.String(), readerCookie, "", uuid.Nil, "", false, http.StatusNotFound)
	accountPath := "/accounts/" + accountID.String()
	call(http.MethodGet, accountPath+"/crm-users?active=true", readerCookie, "", uuid.Nil, "", false, http.StatusOK)
	call(http.MethodGet, accountPath+"/crm-users", readerCookie, "", uuid.Nil, "", false, http.StatusServiceUnavailable)
	call(http.MethodGet, "/accounts?q=grants-version", readerCookie, "", uuid.Nil, "", false, http.StatusServiceUnavailable)

	const patch = `{"reason":"fixture","note":null}`
	call(http.MethodPatch, accountPath+"/profile", readerCookie, patch, profileKey, "\"1\"", true, http.StatusForbidden)
	call(http.MethodPatch, accountPath+"/profile", writerCookie, `{"note":"first","note":null,"reason":"fixture"}`, profileKey, "\"1\"", true, http.StatusBadRequest)
	lost := call(http.MethodPatch, accountPath+"/profile", writerCookie, patch, profileKey, "\"1\"", true, http.StatusAccepted)
	var unknown managerOperationResponse
	if err := json.Unmarshal(lost.Body.Bytes(), &unknown); err != nil || unknown.ID == uuid.Nil || unknown.State != managerplatform.UnknownOutcome {
		t.Fatalf("lost command was not recoverable: %s", lost.Body.String())
	}
	if lost.Header().Get("Location") != browser+"/operations/"+unknown.ID.String() {
		t.Fatalf("wrong recovery Location: %s", lost.Header().Get("Location"))
	}
	replayed := call(http.MethodPatch, accountPath+"/profile", writerCookie, `{"note":null,"reason":"fixture"}`, profileKey, "\"1\"", true, http.StatusOK)
	if replayed.Header().Get("ETag") != "\"2\"" {
		t.Fatal("exact retry lost the resource version")
	}
	conflict := call(http.MethodPatch, accountPath+"/profile", writerCookie, patch, staleKey, "\"1\"", true, http.StatusConflict)
	if !strings.Contains(conflict.Body.String(), `"current_version":2`) || !strings.Contains(conflict.Body.String(), `"code":"version_conflict"`) {
		t.Fatalf("unsafe or incomplete conflict: %s", conflict.Body.String())
	}
	const refreshBody = `{"components":["users"],"reason":"fixture refresh"}`
	ack := call(http.MethodPost, accountPath+"/refresh", writerCookie, refreshBody, refreshKey, "", true, http.StatusAccepted)
	var accepted managerOperationResponse
	if err := json.Unmarshal(ack.Body.Bytes(), &accepted); err != nil || accepted.State != managerplatform.PlatformResult ||
		accepted.Operation == nil || accepted.Operation.TargetID != accountID || ack.Header().Get("Location") != browser+"/operations/"+accepted.ID.String() {
		t.Fatalf("refresh lost owner identity or local poll link: %s", ack.Body.String())
	}
	call(http.MethodGet, "/operations/"+accepted.ID.String(), readerCookie, "", uuid.Nil, "", false, http.StatusNotFound)
	call(http.MethodGet, "/operations/"+accepted.ID.String(), writerCookie, "", uuid.Nil, "", false, http.StatusOK)
	call(http.MethodPut, "/portrait-template", writerCookie, `{"topics":[]}`, uuid.New(), "\"1\"", true, http.StatusOK)
	mu.Lock()
	revokeReadOnPoll = true
	mu.Unlock()
	call(http.MethodGet, "/operations/"+accepted.ID.String(), writerCookie, "", uuid.Nil, "", false, http.StatusForbidden)
	call(http.MethodGet, "/operations/"+accepted.ID.String(), writerCookie, "", uuid.Nil, "", false, http.StatusForbidden)
	if _, err := pool.Exec(ctx, "INSERT INTO manager_grants(employee_id,grant_code) VALUES($1,'clients.read')", writer.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "DELETE FROM manager_grants WHERE employee_id=$1 AND grant_code='clients.write'", writer.ID); err != nil {
		t.Fatal(err)
	}
	call(http.MethodGet, "/operations/"+accepted.ID.String(), writerCookie, "", uuid.Nil, "", false, http.StatusForbidden)
	mu.Lock()
	defer mu.Unlock()
	if readCalls != 3 || profileAttempts != 2 || refreshAttempts != 1 {
		t.Fatalf("owner call counts reads=%d profiles=%d refresh=%d", readCalls, profileAttempts, refreshAttempts)
	}
}
