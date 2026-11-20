package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/managerplatform"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestManagerProductsGrantAndReplayBoundary(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := t.Context()
	const origin = "https://managers.example.invalid"
	const prefix = "/api/v1/managers"
	store := employees.NewStore(pool, 8*time.Second)
	audits := audit.NewStore(pool, 8*time.Second)
	sessions := auth.NewManagerService(pool, 8*time.Second, time.Hour, time.Hour, true)
	core := auth.NewService(pool, 8*time.Second, time.Hour, time.Hour, true)
	cookies := map[string]string{}
	ids := map[string]uuid.UUID{}
	for _, grant := range []string{"catalog.manage", "catalog.read", "stats.read", "clients.read"} {
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
	product := uuid.New()
	key := uuid.New()
	var command uuid.UUID
	attempts := 0
	var firstBody string
	revoke := false
	body := `{"code":"fixture-product","display_name":"Fixture","line":"FREE","availability":"active","integration_refs":[],"links":[],"trial_policy":{"kind":"free","duration_days":null},"tariff_version":null}`
	// Product identity belongs to the owner and can predate this command.
	response := func() map[string]any {
		var data map[string]any
		_ = json.Unmarshal([]byte(body), &data)
		data["id"] = product
		data["version"] = 7
		return data
	}
	_, cfg := startManagerPlatformPeer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		encoded, err := base64.RawURLEncoding.DecodeString(r.Header.Get("X-Platform-Actor"))
		var actor wire.ManagerContext
		if err != nil || json.Unmarshal(encoded, &actor) != nil || r.TLS == nil {
			t.Error("missing certified actor")
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/internal/platform/v1/managers")
		if strings.HasPrefix(path, "/commands/") {
			if actor.Actor.SubjectId != ids["catalog.manage"] {
				t.Error("wrong receipt actor")
			}
			if revoke {
				_, err := pool.Exec(r.Context(), "DELETE FROM manager_grants WHERE employee_id=$1", ids["catalog.manage"])
				if err != nil {
					t.Error(err)
				}
			}
			httpx.WriteJSON(w, 200, map[string]any{"id": command, "kind": "product.create", "state": "completed"})
			return
		}
		if strings.HasSuffix(path, "/metrics") {
			httpx.WriteJSON(w, 200, map[string]any{"activations": 0, "active_accesses": 2, "confirmed_installations": 3, "snapshot_at": time.Now().UTC()})
			return
		}
		if r.Method == "POST" {
			raw, _ := io.ReadAll(r.Body)
			attempts++
			if attempts == 1 {
				command = *actor.CommandId
				firstBody = string(raw)
				w.WriteHeader(503)
				return
			}
			if command != *actor.CommandId || firstBody != string(raw) || r.Header.Get("Idempotency-Key") != key.String() {
				t.Error("retry changed command identity")
			}
			w.Header().Set("ETag", `"7"`)
			httpx.WriteJSON(w, 201, response())
			return
		}
		if r.Method == "PATCH" {
			if r.Header.Get("If-Match") != `"7"` {
				t.Error("wrong version")
			}
			w.Header().Set("ETag", `"7"`)
			httpx.WriteJSON(w, 200, response())
			return
		}
		if len(actor.Actor.Grants) != 1 || actor.Actor.Grants[0] != wire.CatalogRead {
			t.Errorf("catalog read actor carried unexpected grants: %v", actor.Actor.Grants)
		}
		w.Header().Set("ETag", `"7"`)
		httpx.WriteJSON(w, 200, response())
	}))
	client, err := managerplatform.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	service := managerplatform.NewService(pool, 8*time.Second, audits, sessions, client, logger)
	router := New(Dependencies{Employees: store, Sessions: core, ManagerSessions: sessions, ManagerPlatform: service, Audit: audits, Limiter: auth.NewLimiter(50), Logger: logger, PublicOrigin: "https://admin.example.invalid", ManagerOrigin: origin})
	call := func(method, path, grant, payload string, k uuid.UUID, etag string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, origin+prefix+path, strings.NewReader(payload))
		r.AddCookie(&http.Cookie{Name: auth.ManagerCookieName, Value: cookies[grant]})
		r.Header.Set("Origin", origin)
		r.Header.Set("X-Requested-With", "admin-ui")
		if payload != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		if k != uuid.Nil {
			r.Header.Set("Idempotency-Key", k.String())
		}
		if etag != "" {
			r.Header.Set("If-Match", etag)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w
	}
	path := "/products/" + product.String()
	call("GET", path, "catalog.manage", "", uuid.Nil, "", 403)
	call("GET", path+"/metrics", "stats.read", "", uuid.Nil, "", 200)
	call("GET", path+"/metrics", "clients.read", "", uuid.Nil, "", 403)
	call("GET", path, "clients.read", "", uuid.Nil, "", 403)
	call("GET", path, "catalog.read", "", uuid.Nil, "", 200)
	call("GET", "/accounts", "catalog.read", "", uuid.Nil, "", 403)
	call("POST", "/products", "clients.read", body, key, "", 403)
	call("POST", "/products", "catalog.manage", body, key, "", 202)
	poll := "/operations/" + command.String()
	call("GET", poll, "stats.read", "", uuid.Nil, "", 404)
	call("GET", poll, "catalog.manage", "", uuid.Nil, "", 200)

	call("POST", "/products", "catalog.manage", body, key, "", 201)
	call("PATCH", path, "catalog.manage", `{"tariff_version":null}`, uuid.New(), `"7"`, 200)
	call("PATCH", path, "catalog.manage", `{"display_name":"Fixture"}`, uuid.New(), "", 400)
	revoke = true
	call("GET", poll, "catalog.manage", "", uuid.Nil, "", 401)
}
