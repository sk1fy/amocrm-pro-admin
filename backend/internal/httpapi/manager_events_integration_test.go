package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestManagerEventsGrantAndRevocationBoundary(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := t.Context()
	const origin = "https://managers.example.invalid"
	store := employees.NewStore(pool, 8*time.Second)
	audits := audit.NewStore(pool, 8*time.Second)
	sessions := auth.NewManagerService(pool, 8*time.Second, time.Hour, time.Hour, true)
	core := auth.NewService(pool, 8*time.Second, time.Hour, time.Hour, true)
	cookies := map[string]string{}
	ids := map[string]uuid.UUID{}
	for _, grant := range []string{"feed.read", "clients.read"} {
		employee := createEmployee(t, ctx, store, strings.ReplaceAll(grant, ".", "-")+"@example.invalid", grant, rbac.RoleViewer)
		ids[grant] = employee.ID
		if _, err := pool.Exec(ctx, "INSERT INTO manager_grants(employee_id,grant_code) VALUES($1,$2)", employee.ID, grant); err != nil {
			t.Fatal(err)
		}
		token, _, err := sessions.Login(ctx, employee.Email, testPassword, "", "")
		if err != nil {
			t.Fatal(err)
		}
		cookies[grant] = token
	}
	account, event := uuid.New(), uuid.New()
	requests := 0
	revoke := false
	changeVersion := false
	peerStatus := http.StatusOK
	_, cfg := startManagerPlatformPeer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		encoded, err := base64.RawURLEncoding.DecodeString(r.Header.Get("X-Platform-Actor"))
		var actor wire.ManagerContext
		if err != nil || json.Unmarshal(encoded, &actor) != nil || r.TLS == nil {
			t.Error("missing certified actor")
			return
		}
		if r.Method != http.MethodGet || actor.CommandId != nil {
			t.Error("event read issued a command")
		}
		if changeVersion {
			if _, err := pool.Exec(r.Context(), "UPDATE employees SET manager_grants_version=manager_grants_version+1 WHERE id=$1", actor.Actor.SubjectId); err != nil {
				t.Error(err)
			}
		}
		if revoke {
			if _, err := pool.Exec(r.Context(), "DELETE FROM manager_grants WHERE employee_id=$1 AND grant_code='feed.read'", actor.Actor.SubjectId); err != nil {
				t.Error(err)
			}
		}
		if peerStatus != 200 {
			w.Header().Set("Retry-After", "7")
			httpx.WriteJSON(w, peerStatus, map[string]any{"error": map[string]any{"code": "invalid_cursor", "message": "cursor expired", "request_id": uuid.New(), "retryable": true}})
			return
		}
		if actor.Actor.SubjectId != ids["feed.read"] && actor.Actor.SubjectId != ids["clients.read"] {
			t.Error("wrong actor")
		}
		httpx.WriteJSON(w, 200, map[string]any{"items": []any{map[string]any{"id": event, "kind": "installed", "account_id": account, "occurred_at": time.Now().UTC(), "recorded_at": time.Now().UTC(), "summary": "Виджет установлен", "related_refs": []any{}}}, "next_cursor": nil, "snapshot_at": time.Now().UTC(), "query_hash": strings.Repeat("a", 64)})
	}))
	client, err := managerplatform.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	service := managerplatform.NewService(pool, 8*time.Second, audits, sessions, client, logger)
	router := New(Dependencies{Employees: store, Sessions: core, ManagerSessions: sessions, ManagerPlatform: service, Audit: audits, Limiter: auth.NewLimiter(50), Logger: logger, PublicOrigin: "https://admin.example.invalid", ManagerOrigin: origin})
	call := func(path, grant string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(http.MethodGet, origin+"/api/v1/managers"+path, nil)
		r.AddCookie(&http.Cookie{Name: auth.ManagerCookieName, Value: cookies[grant]})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("GET %s as %s=%d want %d: %s", path, grant, w.Code, want, w.Body.String())
		}
		return w
	}
	history := "/accounts/" + account.String() + "/history"
	call("/feed", "clients.read", 403)
	call(history, "feed.read", 403)
	if requests != 0 {
		t.Fatal("denied request reached owner")
	}
	feed := call("/feed?kind=installed&kind=uninstalled&limit=10", "feed.read", 200)
	historyResponse := call(history, "clients.read", 200)
	for _, response := range []*httptest.ResponseRecorder{feed, historyResponse} {
		var page wire.EventList
		if json.Unmarshal(response.Body.Bytes(), &page) != nil || len(page.Items) != 1 || page.Items[0].Id != event {
			t.Fatal("feed/history changed event identity")
		}
	}
	peerStatus = 400
	bad := call("/feed?cursor=expired", "feed.read", 400)
	if !strings.Contains(bad.Body.String(), "invalid_cursor") {
		t.Fatal("lost invalid cursor state")
	}
	peerStatus = 429
	limited := call("/feed", "feed.read", 429)
	if limited.Header().Get("Retry-After") != "7" {
		t.Fatal("lost owner retry interval")
	}
	peerStatus = 503
	call("/feed", "feed.read", 503)
	peerStatus = 200
	changeVersion = true
	call("/feed", "feed.read", 503)
	changed := call("/feed?cursor=stale", "feed.read", 400)
	if !strings.Contains(changed.Body.String(), "invalid_cursor") {
		t.Fatal("changed grants version retained cursor")
	}
	changeVersion = false
	revoke = true
	call("/feed", "feed.read", 401)
	revoke = false
	before := requests
	call("/feed", "feed.read", 401)
	if requests != before {
		t.Fatal("revoked feed read reached owner")
	}
	call(history, "clients.read", 200)
}
