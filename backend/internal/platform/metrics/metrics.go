// Package metrics exposes process-local Prometheus metrics for the Admin API.
//
// The package owns a dedicated registry so the /metrics endpoint exposes only
// the families declared here. All label values are finite: routes come from
// chi patterns, methods and probe outcomes from closed sets. Account,
// installation, employee, job and session identifiers, emails, domains and
// request ids must never be used as label values.
package metrics

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Canonical backend probe outcomes. The set is closed: any other value is
// recorded as OutcomeUnknown.
const (
	OutcomeAvailable             = "available"
	OutcomeBackendUnavailable    = "backend_unavailable"
	OutcomeBackendTimeout        = "backend_timeout"
	OutcomeCapabilityUnavailable = "capability_unavailable"
	OutcomeUnknown               = "unknown"
)

const (
	routeUnmatched = "unmatched"
	methodOther    = "other"
)

var (
	httpRequestsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "admin_http_requests_total",
		Help: "Total number of Admin API HTTP requests.",
	}, []string{"route", "method", "status"})

	httpRequestDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name: "admin_http_request_duration_seconds",
		Help: "Admin API HTTP request duration in seconds.",
	}, []string{"route", "method"})

	backendProbesTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "admin_backend_probes_total",
		Help: "Total number of backend probes by canonical outcome.",
	}, []string{"backend", "outcome"})

	backendUp = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "admin_backend_up",
		Help: "Backend availability from the last probe: 1 available, 0 otherwise.",
	}, []string{"backend"})

	backendLastResponse = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "admin_backend_last_response_timestamp_seconds",
		Help: "Unix time of the last successful backend response.",
	}, []string{"backend"})

	registry = newRegistry()
	handler  = promhttp.HandlerFor(registry, promhttp.HandlerOpts{})
)

func newRegistry() *prometheus.Registry {
	registry := prometheus.NewRegistry()
	registry.MustRegister(
		httpRequestsTotal,
		httpRequestDuration,
		backendProbesTotal,
		backendUp,
		backendLastResponse,
	)
	return registry
}

// ObserveHTTP records one finished public API request. route must be the chi
// route pattern (or "unmatched"), status the numeric HTTP status.
func ObserveHTTP(route, method string, status int, seconds float64) {
	route = strings.TrimSpace(route)
	if route == "" {
		route = routeUnmatched
	}
	method = normalizeMethod(method)
	statusLabel := strconv.Itoa(status)
	httpRequestsTotal.WithLabelValues(route, method, statusLabel).Inc()
	httpRequestDuration.WithLabelValues(route, method).Observe(seconds)
}

// ObserveBackendProbe records one backend probe result. outcome is normalized
// to the closed set. observedAt is the last successful response time and is
// written only when it exists.
func ObserveBackendProbe(backend, outcome string, observedAt *time.Time) {
	outcome = normalizeOutcome(outcome)
	backendProbesTotal.WithLabelValues(backend, outcome).Inc()
	value := 0.0
	if outcome == OutcomeAvailable {
		value = 1
	}
	backendUp.WithLabelValues(backend).Set(value)
	if observedAt != nil && !observedAt.IsZero() {
		backendLastResponse.WithLabelValues(backend).Set(float64(observedAt.Unix()))
	}
}

// Handler returns the scrape handler for the Admin API management listener.
func Handler() http.Handler {
	return handler
}

// HTTPMiddleware captures the response status and records request metrics.
// It must run after httpx.RequestID and before authentication so rejected
// requests are counted too.
func HTTPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		route := routeUnmatched
		if ctx := chi.RouteContext(r.Context()); ctx != nil && ctx.RoutePattern() != "" {
			route = ctx.RoutePattern()
		}
		ObserveHTTP(route, r.Method, recorder.status, time.Since(started).Seconds())
	})
}

func normalizeMethod(method string) string {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut,
		http.MethodPatch, http.MethodDelete, http.MethodOptions:
		return method
	default:
		return methodOther
	}
}

func normalizeOutcome(outcome string) string {
	switch outcome {
	case OutcomeAvailable, OutcomeBackendUnavailable, OutcomeBackendTimeout,
		OutcomeCapabilityUnavailable, OutcomeUnknown:
		return outcome
	default:
		return OutcomeUnknown
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusRecorder) Unwrap() http.ResponseWriter { return w.ResponseWriter }
