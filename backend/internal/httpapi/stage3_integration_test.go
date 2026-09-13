package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
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
	router := testRouterWithRegistry(t, pool, 10, catalog.FromBackends(fixture.Demo("core"), fixture.Module("fixture")))
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

	defaultStats := doJSON(t, router, http.MethodGet, "/api/v1/stats", "", viewerCookie)
	if defaultStats.Code != http.StatusOK {
		t.Fatalf("default stats=%d %s", defaultStats.Code, defaultStats.Body.String())
	}
	var defaultStatsBody struct {
		Period string `json:"period"`
		Items  []struct {
			Data *struct {
				Period string `json:"period"`
			} `json:"data"`
		} `json:"items"`
	}
	decodeBody(t, defaultStats, &defaultStatsBody)
	if defaultStatsBody.Period != adapter.StatsPeriod7d {
		t.Fatalf("default period=%q", defaultStatsBody.Period)
	}
	coreDefault := false
	for _, item := range defaultStatsBody.Items {
		if item.Data == nil {
			continue
		}
		coreDefault = true
		if item.Data.Period != adapter.StatsPeriod7d {
			t.Fatalf("default snapshot period=%q", item.Data.Period)
		}
	}
	if !coreDefault {
		t.Fatalf("default stats missing data: %s", defaultStats.Body.String())
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

	type registryEntry struct {
		Backend             string     `json:"backend"`
		Kind                string     `json:"kind"`
		DisplayName         string     `json:"display_name"`
		Status              string     `json:"status"`
		ContractVersion     string     `json:"contract_version"`
		Revision            string     `json:"revision"`
		AdapterCapabilities []string   `json:"adapter_capabilities"`
		BackendCapabilities []string   `json:"backend_capabilities"`
		ObservedAt          *time.Time `json:"observed_at"`
		CheckedAt           time.Time  `json:"checked_at"`
		Error               *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	backends := doJSON(t, router, http.MethodGet, "/api/v1/system/backends", "", viewerCookie)
	if backends.Code != http.StatusOK {
		t.Fatalf("backends=%d %s", backends.Code, backends.Body.String())
	}
	assertNoSecretJSONKeys(t, backends.Body.Bytes())
	var backendsBody struct {
		Items         []registryEntry `json:"items"`
		Observability struct {
			GrafanaBaseURL string `json:"grafana_base_url"`
			LokiBaseURL    string `json:"loki_base_url"`
		} `json:"observability"`
	}
	decodeBody(t, backends, &backendsBody)
	if len(backendsBody.Items) != 2 {
		t.Fatalf("backends=%s", backends.Body.String())
	}
	byBackend := map[string]registryEntry{}
	for _, item := range backendsBody.Items {
		byBackend[item.Backend] = item
	}
	core, ok := byBackend["core"]
	if !ok {
		t.Fatalf("core backend missing: %s", backends.Body.String())
	}
	module, ok := byBackend["fixture"]
	if !ok {
		t.Fatalf("fixture backend missing: %s", backends.Body.String())
	}
	for _, item := range []registryEntry{core, module} {
		if item.Status != adapter.SourceAvailable {
			t.Fatalf("backend %s status=%q", item.Backend, item.Status)
		}
		if item.ObservedAt == nil || item.CheckedAt.IsZero() {
			t.Fatalf("backend %s observed_at=%v checked_at=%v", item.Backend, item.ObservedAt, item.CheckedAt)
		}
		if item.Error != nil {
			t.Fatalf("backend %s error=%+v", item.Backend, item.Error)
		}
		if item.AdapterCapabilities == nil || item.BackendCapabilities == nil {
			t.Fatalf("backend %s capabilities must not be null: %s", item.Backend, backends.Body.String())
		}
	}
	if core.Kind != adapter.KindFixture || core.ContractVersion != adapter.ContractVersion {
		t.Fatalf("core=%+v", core)
	}
	if !slices.Contains(core.AdapterCapabilities, "subscriptions") {
		t.Fatalf("core adapter capabilities=%v", core.AdapterCapabilities)
	}
	if slices.Contains(module.AdapterCapabilities, "subscriptions") {
		t.Fatalf("module adapter capabilities=%v", module.AdapterCapabilities)
	}
	if module.Revision != "fixture-module" {
		t.Fatalf("module revision=%q", module.Revision)
	}
	if backendsBody.Observability.GrafanaBaseURL == "" {
		t.Fatalf("observability=%s", backends.Body.String())
	}
}

func TestStage3SharedViewsAdminOnly(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	router := testRouterWithRegistry(t, pool, 10, catalog.FromBackends(fixture.Demo("core")))
	ctx := t.Context()
	store := employees.NewStore(pool, 2*time.Second)
	admin := createEmployee(t, ctx, store, "views-admin@example.invalid", "Admin", rbac.RoleAdmin)
	operator := createEmployee(t, ctx, store, "views-operator@example.invalid", "Operator", rbac.RoleOperator)
	viewer := createEmployee(t, ctx, store, "views-viewer@example.invalid", "Viewer", rbac.RoleViewer)
	adminCookie := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(admin.Email, testPassword), ""))
	operatorCookie := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(operator.Email, testPassword), ""))
	viewerCookie := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(viewer.Email, testPassword), ""))

	personal := doJSON(t, router, http.MethodPost, "/api/v1/views", `{"section":"accounts","name":"operator-personal","params":{"problem":"reauth_required"}}`, operatorCookie)
	if personal.Code != http.StatusCreated {
		t.Fatalf("operator personal view=%d %s", personal.Code, personal.Body.String())
	}
	assertNoSecretJSONKeys(t, personal.Body.Bytes())
	var personalView viewDTO
	decodeBody(t, personal, &personalView)
	if personalView.Shared || personalView.OwnerEmployeeID == nil {
		t.Fatalf("personal view=%+v", personalView)
	}

	sharedAttempt := doJSON(t, router, http.MethodPost, "/api/v1/views", `{"section":"accounts","name":"operator-shared","shared":true}`, operatorCookie)
	if sharedAttempt.Code != http.StatusForbidden {
		t.Fatalf("operator shared view=%d %s", sharedAttempt.Code, sharedAttempt.Body.String())
	}
	assertErrorCode(t, sharedAttempt, "forbidden")
	viewerAttempt := doJSON(t, router, http.MethodPost, "/api/v1/views", `{"section":"accounts","name":"viewer-shared","shared":true}`, viewerCookie)
	if viewerAttempt.Code != http.StatusForbidden {
		t.Fatalf("viewer shared view=%d %s", viewerAttempt.Code, viewerAttempt.Body.String())
	}

	adminPersonal := doJSON(t, router, http.MethodPost, "/api/v1/views", `{"section":"accounts","name":"admin-personal"}`, adminCookie)
	if adminPersonal.Code != http.StatusCreated {
		t.Fatalf("admin personal view=%d %s", adminPersonal.Code, adminPersonal.Body.String())
	}
	var adminPersonalView viewDTO
	decodeBody(t, adminPersonal, &adminPersonalView)

	shared := doJSON(t, router, http.MethodPost, "/api/v1/views", `{"section":"accounts","name":"admin-shared","shared":true}`, adminCookie)
	if shared.Code != http.StatusCreated {
		t.Fatalf("admin shared view=%d %s", shared.Code, shared.Body.String())
	}
	assertNoSecretJSONKeys(t, shared.Body.Bytes())
	var sharedView viewDTO
	decodeBody(t, shared, &sharedView)
	if !sharedView.Shared || sharedView.OwnerEmployeeID != nil {
		t.Fatalf("shared view=%+v", sharedView)
	}

	listed := doJSON(t, router, http.MethodGet, "/api/v1/views?section=accounts", "", operatorCookie)
	if listed.Code != http.StatusOK {
		t.Fatalf("list views=%d %s", listed.Code, listed.Body.String())
	}
	var listBody struct {
		Items []viewDTO `json:"items"`
	}
	decodeBody(t, listed, &listBody)
	if len(listBody.Items) != 2 {
		t.Fatalf("operator views=%s", listed.Body.String())
	}
	for _, item := range listBody.Items {
		if item.Name == "operator-shared" || item.Name == "viewer-shared" {
			t.Fatalf("forbidden shared view was created: %+v", item)
		}
	}

	patchShared := doJSON(t, router, http.MethodPatch, "/api/v1/views/"+sharedView.ID, `{"name":"operator-renamed"}`, operatorCookie)
	if patchShared.Code != http.StatusForbidden {
		t.Fatalf("operator patch shared=%d %s", patchShared.Code, patchShared.Body.String())
	}
	deleteShared := doJSON(t, router, http.MethodDelete, "/api/v1/views/"+sharedView.ID, "", operatorCookie)
	if deleteShared.Code != http.StatusForbidden {
		t.Fatalf("operator delete shared=%d %s", deleteShared.Code, deleteShared.Body.String())
	}
	patchForeign := doJSON(t, router, http.MethodPatch, "/api/v1/views/"+adminPersonalView.ID, `{"name":"operator-renamed"}`, operatorCookie)
	if patchForeign.Code != http.StatusForbidden {
		t.Fatalf("operator patch foreign personal=%d %s", patchForeign.Code, patchForeign.Body.String())
	}

	patchOwn := doJSON(t, router, http.MethodPatch, "/api/v1/views/"+personalView.ID, `{"name":"operator-personal-renamed"}`, operatorCookie)
	if patchOwn.Code != http.StatusOK {
		t.Fatalf("operator patch own=%d %s", patchOwn.Code, patchOwn.Body.String())
	}
	patchAdminShared := doJSON(t, router, http.MethodPatch, "/api/v1/views/"+sharedView.ID, `{"name":"admin-shared-renamed"}`, adminCookie)
	if patchAdminShared.Code != http.StatusOK {
		t.Fatalf("admin patch shared=%d %s", patchAdminShared.Code, patchAdminShared.Body.String())
	}
	deleteAdminShared := doJSON(t, router, http.MethodDelete, "/api/v1/views/"+sharedView.ID, "", adminCookie)
	if deleteAdminShared.Code != http.StatusOK {
		t.Fatalf("admin delete shared=%d %s", deleteAdminShared.Code, deleteAdminShared.Body.String())
	}
	deleteOwn := doJSON(t, router, http.MethodDelete, "/api/v1/views/"+personalView.ID, "", operatorCookie)
	if deleteOwn.Code != http.StatusOK {
		t.Fatalf("operator delete own=%d %s", deleteOwn.Code, deleteOwn.Body.String())
	}
}
