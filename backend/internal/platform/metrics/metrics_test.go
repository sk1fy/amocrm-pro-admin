package metrics

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

var uuidLike = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)

func scrape(t *testing.T) string {
	t.Helper()
	recorder := httptest.NewRecorder()
	Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("metrics status = %d", recorder.Code)
	}
	return recorder.Body.String()
}

func TestObserveHTTPRecordsRouteMethodStatus(t *testing.T) {
	route := "/api/v1/connections/{backend}/{connection_id}"
	ObserveHTTP(route, http.MethodGet, http.StatusNotFound, 0.25)

	body := scrape(t)
	for _, want := range []string{
		"admin_http_requests_total",
		`route="` + route + `"`,
		`method="GET"`,
		`status="404"`,
		"admin_http_request_duration_seconds",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics missing %q:\n%s", want, body)
		}
	}
}

func TestObserveHTTPRecordsGivenRouteVerbatim(t *testing.T) {
	pattern := "/api/v1/connections/{backend}/{connection_id}"
	ObserveHTTP(pattern, http.MethodGet, http.StatusUnauthorized, 0.01)

	body := scrape(t)
	if !strings.Contains(body, `route="`+pattern+`"`) {
		t.Fatalf("route label missing:\n%s", body)
	}
	if strings.Contains(body, `route="/api/v1/connections/core/`) {
		t.Fatalf("metrics invented a concrete route label:\n%s", body)
	}
	if uuidLike.MatchString(body) {
		t.Fatalf("metrics output contains a UUID:\n%s", body)
	}
}

func TestObserveBackendProbeRecordsOutcomes(t *testing.T) {
	observedAt := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	ObserveBackendProbe("core", OutcomeAvailable, &observedAt)
	ObserveBackendProbe("fixture", OutcomeBackendUnavailable, nil)
	ObserveBackendProbe("foreign", "not-a-canonical-outcome", nil)

	body := scrape(t)
	for _, want := range []string{
		`admin_backend_up{backend="core"} 1`,
		`admin_backend_up{backend="fixture"} 0`,
		`admin_backend_probes_total{backend="core",outcome="available"} 1`,
		`admin_backend_probes_total{backend="fixture",outcome="backend_unavailable"} 1`,
		`admin_backend_probes_total{backend="foreign",outcome="unknown"} 1`,
		`admin_backend_last_response_timestamp_seconds{backend="core"}`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics missing %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, `admin_backend_last_response_timestamp_seconds{backend="fixture"}`) {
		t.Fatalf("timestamp must not be set without a successful response:\n%s", body)
	}
}

func TestHTTPMiddlewareLabelsUseRoutePattern(t *testing.T) {
	connectionID := "6d1f9b3a-0f2f-4c8a-9a1e-2c7b5d4e8f01"
	router := chi.NewRouter()
	router.Use(HTTPMiddleware)
	router.Get("/api/v1/connections/{backend}/{connection_id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/connections/core/"+connectionID, nil))

	body := scrape(t)
	if !strings.Contains(body, `route="/api/v1/connections/{backend}/{connection_id}"`) {
		t.Fatalf("route pattern missing:\n%s", body)
	}
	if strings.Contains(body, connectionID) {
		t.Fatalf("concrete id leaked into labels:\n%s", body)
	}
}
