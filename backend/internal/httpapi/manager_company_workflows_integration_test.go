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

func TestManagerCompanyWorkflowCatalogOnlyExactRetry(t *testing.T) {
	t.Run("product workflow", func(t *testing.T) {
		product := uuid.New()
		checkManagerWorkflowRetry(t, "/products/"+product.String()+"/company-workflow", "product.company_workflow.set", map[string]any{"product_id": product, "write_ready": false})
	})
	t.Run("shared installation settings", func(t *testing.T) {
		checkManagerWorkflowRetry(t, "/installation-deal-settings", "installation.deal_settings.set", nil)
	})
}

func checkManagerWorkflowRetry(t *testing.T, path, kind string, fields map[string]any) {
	t.Helper()

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
	for _, grant := range []string{"catalog.manage", "clients.read"} {
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
	generation, key := uuid.New(), uuid.New()
	var command uuid.UUID
	body := `{"source_account_id":"71","binding_revision":"fixture-v1","metadata_generation_id":"` + generation.String() + `","pipeline_id":"11","initial_stage_id":"12"}`
	attempts := 0
	var original string
	mode := "retry"
	_, cfg := startManagerPlatformPeer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := base64.RawURLEncoding.DecodeString(r.Header.Get("X-Platform-Actor"))
		var actor wire.ManagerContext
		if json.Unmarshal(raw, &actor) != nil || actor.Actor.SubjectId != ids["catalog.manage"] {
			t.Error("current catalog-only actor required")
		}
		upstreamPath := strings.TrimPrefix(r.URL.Path, "/internal/platform/v1/managers")
		if strings.HasPrefix(upstreamPath, "/commands/") {
			if mode == "retry" {
				httpx.WriteJSON(w, 404, map[string]any{"error": map[string]any{"request_id": uuid.New(), "code": "not_found", "message": "not found", "retryable": false}})
				return
			}
			httpx.WriteJSON(w, 200, map[string]any{"id": command, "kind": kind, "state": "completed"})
			return
		}
		if upstreamPath != path {
			t.Errorf("upstream path %s, want %s", upstreamPath, path)
		}
		response := map[string]any{"version": 1, "configuration": nil}
		for name, value := range fields {
			response[name] = value
		}
		if r.Method == "PUT" {
			received, _ := io.ReadAll(r.Body)
			attempts++
			if actor.CommandId == nil || r.Header.Get("Idempotency-Key") != key.String() || r.Header.Get("If-Match") != `"1"` {
				t.Error("command identity missing")
			}
			if attempts == 1 {
				command = *actor.CommandId
				original = string(received)
				w.Header().Set("Retry-After", "0")
				httpx.WriteJSON(w, 503, map[string]any{"error": map[string]any{"request_id": uuid.New(), "code": "company_metadata_unavailable", "message": "source unavailable", "retryable": true}})
				return
			}
			if command != *actor.CommandId || original != string(received) {
				t.Error("retry changed exact command")
			}
			mode = "committed"
			w.Header().Set("ETag", `"2"`)
			response["version"] = 2
			response["configuration"] = map[string]any{"revision": 1, "source_account_id": "71", "binding_revision": "fixture-v1", "metadata_generation_id": generation, "pipeline_id": "11", "initial_stage_id": "12", "validated_at": time.Now().UTC()}
			httpx.WriteJSON(w, 200, response)
			return
		}
		w.Header().Set("ETag", `"1"`)
		httpx.WriteJSON(w, 200, response)
	}))
	client, err := managerplatform.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	service := managerplatform.NewService(pool, 8*time.Second, audits, sessions, client, logger)
	router := New(Dependencies{Employees: store, Sessions: core, ManagerSessions: sessions, ManagerPlatform: service, Audit: audits, Limiter: auth.NewLimiter(50), Logger: logger, PublicOrigin: "https://admin.example.invalid", ManagerOrigin: origin})
	call := func(method, path, grant, payload string, csrf bool, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, origin+"/api/v1/managers"+path, strings.NewReader(payload))
		r.AddCookie(&http.Cookie{Name: auth.ManagerCookieName, Value: cookies[grant]})
		if csrf {
			r.Header.Set("Origin", origin)
			r.Header.Set("X-Requested-With", "admin-ui")
		}
		if payload != "" {
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Idempotency-Key", key.String())
			r.Header.Set("If-Match", `"1"`)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s status %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w
	}
	call("GET", path, "catalog.manage", "", true, 200)
	call("GET", path, "clients.read", "", true, 403)
	call("PUT", path, "catalog.manage", body, false, 403)
	call("PUT", path, "clients.read", body, true, 403)
	call("PUT", path, "catalog.manage", body, true, 202)
	if command == uuid.Nil {
		t.Fatal("no durable owner command")
	}
	poll := "/operations/" + command.String()
	call("GET", poll, "clients.read", "", true, 404)
	// Local pacing belongs to the same stored intent, never to a new identity.
	if _, err := pool.Exec(ctx, "UPDATE manager_command_intents SET next_check_at=now()-interval '1 minute' WHERE id=$1", command); err != nil {
		t.Fatal(err)
	}
	call("PUT", path, "catalog.manage", body, true, 200)
	if attempts != 2 {
		t.Fatalf("attempts %d", attempts)
	}
	call("GET", poll, "catalog.manage", "", true, 200)
	if _, err := pool.Exec(ctx, "DELETE FROM manager_grants WHERE employee_id=$1", ids["catalog.manage"]); err != nil {
		t.Fatal(err)
	}
	call("GET", poll, "catalog.manage", "", true, 401)
}
