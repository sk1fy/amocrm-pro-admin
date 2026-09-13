package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
	"github.com/sk1fy/amocrm-pro-admin/internal/catalog"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

const stage4MetricsConnectionID = "6d1f9b3a-0f2f-4c8a-9a1e-2c7b5d4e8f01"

func managementHandler(t *testing.T, pool *pgxpool.Pool) http.Handler {
	t.Helper()
	return Management(pool, 2*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func scrapeMetrics(t *testing.T, management http.Handler) string {
	t.Helper()
	recorder := doJSON(t, management, http.MethodGet, "/metrics", "", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("metrics=%d %s", recorder.Code, recorder.Body.String())
	}
	return recorder.Body.String()
}

func TestStage4MetricsHTTPRouteLabels(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	router := testRouterWithRegistry(t, pool, 10, catalog.FromBackends(fixture.Demo("core")))
	management := managementHandler(t, pool)

	path := "/api/v1/connections/core/" + stage4MetricsConnectionID
	request := doJSON(t, router, http.MethodGet, path, "", "")
	if request.Code != http.StatusUnauthorized {
		t.Fatalf("request=%d %s", request.Code, request.Body.String())
	}

	body := scrapeMetrics(t, management)
	if !strings.Contains(body, `route="/api/v1/connections/{backend}/{connection_id}"`) {
		t.Fatalf("route pattern missing:\n%s", body)
	}
	if strings.Contains(body, stage4MetricsConnectionID) {
		t.Fatalf("concrete id leaked into metrics:\n%s", body)
	}
	if !strings.Contains(body, "admin_http_requests_total") {
		t.Fatalf("requests family missing:\n%s", body)
	}
	if !strings.Contains(body, `method="GET"`) {
		t.Fatalf("method label missing:\n%s", body)
	}
	if !strings.Contains(body, `status="`+strconv.Itoa(request.Code)+`"`) {
		t.Fatalf("status label missing:\n%s", body)
	}
}

func TestStage4MetricsBackendProbes(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	registry := catalog.FromBackends(fixture.Demo("core"), fixture.Unavailable("fixture"))
	router := testRouterWithRegistry(t, pool, 10, registry)
	management := managementHandler(t, pool)

	store := employees.NewStore(pool, 2*time.Second)
	admin := createEmployee(t, t.Context(), store, "metrics-admin@example.invalid", "Admin", rbac.RoleAdmin)
	adminCookie := sessionCookie(t, doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(admin.Email, testPassword), ""))

	backends := doJSON(t, router, http.MethodGet, "/api/v1/system/backends", "", adminCookie)
	if backends.Code != http.StatusOK {
		t.Fatalf("backends=%d %s", backends.Code, backends.Body.String())
	}

	body := scrapeMetrics(t, management)
	for _, want := range []string{
		`admin_backend_up{backend="core"} 1`,
		`admin_backend_up{backend="fixture"} 0`,
		`admin_backend_probes_total{backend="fixture",outcome="backend_unavailable"}`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics missing %q:\n%s", want, body)
		}
	}
}
