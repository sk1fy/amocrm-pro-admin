package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/catalog"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestStage3StatsViewsAndActivity(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	router := testRouterWithRegistry(t, pool, 10, catalog.FromBackends(fixture.Demo("core")))
	ctx := t.Context()
	store := employees.NewStore(pool, 2*time.Second)
	admin := createEmployee(t, ctx, store, "stage3-admin@example.invalid", "Admin", rbac.RoleAdmin)
	viewer := createEmployee(t, ctx, store, "stage3-viewer@example.invalid", "Viewer", rbac.RoleViewer)
	adminCookie := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(admin.Email, testPassword), ""))
	viewerCookie := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(viewer.Email, testPassword), ""))
	connection := "f1a00000-0000-4000-8000-000000000001"

	stats := doJSON(t, router, http.MethodGet, "/api/v1/stats?period=24h", "", viewerCookie)
	if stats.Code != http.StatusOK {
		t.Fatalf("stats=%d %s", stats.Code, stats.Body.String())
	}
	assertNoSecretJSONKeys(t, stats.Body.Bytes())
	var statsBody struct {
		Items []struct {
			Data *struct {
				Disconnected *int   `json:"disconnected"`
				LatencyP50Ms *int64 `json:"latency_p50_ms"`
			} `json:"data"`
		} `json:"items"`
	}
	decodeBody(t, stats, &statsBody)
	if len(statsBody.Items) == 0 || statsBody.Items[0].Data == nil {
		t.Fatalf("stats items=%s", stats.Body.String())
	}
	if statsBody.Items[0].Data.Disconnected == nil || *statsBody.Items[0].Data.Disconnected != 0 {
		t.Fatalf("disconnected=%v", statsBody.Items[0].Data.Disconnected)
	}
	if statsBody.Items[0].Data.LatencyP50Ms != nil {
		t.Fatal("latency must stay null")
	}

	settings := doJSON(t, router, http.MethodGet, "/api/v1/connections/core/"+connection+"/activity/settings", "", viewerCookie)
	if settings.Code != http.StatusOK {
		t.Fatalf("settings=%d %s", settings.Code, settings.Body.String())
	}
	assertNoSecretJSONKeys(t, settings.Body.Bytes())

	card := doJSON(t, router, http.MethodGet, "/api/v1/connections/core/"+connection, "", viewerCookie)
	if card.Code != http.StatusOK {
		t.Fatalf("card=%d %s", card.Code, card.Body.String())
	}
	assertNoSecretJSONKeys(t, card.Body.Bytes())
	var cardBody struct {
		ActivitySync struct {
			Data *struct {
				State      string `json:"state"`
				LagSeconds *int64 `json:"lag_seconds"`
			} `json:"data"`
		} `json:"activity_sync"`
	}
	decodeBody(t, card, &cardBody)
	if cardBody.ActivitySync.Data == nil || cardBody.ActivitySync.Data.State != "idle" || cardBody.ActivitySync.Data.LagSeconds == nil || *cardBody.ActivitySync.Data.LagSeconds != 12 {
		t.Fatalf("activity_sync=%s", card.Body.String())
	}

	created := doJSON(t, router, http.MethodPost, "/api/v1/views", `{"section":"accounts","name":"reauth","params":{"problem":"reauth_required"},"columns":["account"]}`, adminCookie)
	if created.Code != http.StatusCreated {
		t.Fatalf("create view=%d %s", created.Code, created.Body.String())
	}
	assertNoSecretJSONKeys(t, created.Body.Bytes())
	forbidden := doJSON(t, router, http.MethodPost, "/api/v1/views", `{"section":"accounts","name":"viewer-view"}`, viewerCookie)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("viewer create view=%d %s", forbidden.Code, forbidden.Body.String())
	}
	listed := doJSON(t, router, http.MethodGet, "/api/v1/views?section=accounts", "", viewerCookie)
	if listed.Code != http.StatusOK {
		t.Fatalf("list views=%d %s", listed.Code, listed.Body.String())
	}

	payload, _ := json.Marshal(map[string]any{"initial_days": 2, "retention_days": 14, "expected_updated_at": 1})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/connections/core/"+connection+"/commands/activity-configure", strings.NewReader(string(payload)))
	req.Header.Set("Origin", testOrigin)
	req.Header.Set("X-Requested-With", auth.RequestedWith)
	req.Header.Set("Idempotency-Key", "stage3-conflict")
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: adminCookie})
	conflict := httptest.NewRecorder()
	router.ServeHTTP(conflict, req)
	if conflict.Code != http.StatusAccepted {
		t.Fatalf("configure=%d %s", conflict.Code, conflict.Body.String())
	}
	assertNoSecretJSONKeys(t, conflict.Body.Bytes())
	var op struct {
		Operation struct {
			State  string         `json:"state"`
			Result map[string]any `json:"result"`
			Error  *struct {
				Code string `json:"code"`
			} `json:"error"`
		} `json:"operation"`
	}
	decodeBody(t, conflict, &op)
	if op.Operation.State != "failed" || op.Operation.Error == nil || op.Operation.Error.Code != "conflict" {
		t.Fatalf("conflict op=%s", conflict.Body.String())
	}
	if op.Operation.Result["retention_days"] != float64(7) {
		t.Fatalf("current settings missing: %v", op.Operation.Result)
	}

	backends := doJSON(t, router, http.MethodGet, "/api/v1/system/backends", "", viewerCookie)
	assertNoSecretJSONKeys(t, backends.Body.Bytes())
}
