package core

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDistributionReadMapsStatesAndDropsUnexpectedFields(t *testing.T) {
	id := "d1500000-0000-4000-8000-000000000001"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Admin-Actor") != "employee:test" {
			t.Error("actor missing")
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "trace") {
			if r.URL.Query().Get("reference") != id || r.URL.Query().Get("limit") != "1" || r.URL.Query().Get("cursor") != "testcursor" {
				t.Error("query lost")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"source": "core", "observed_at": time.Now().UTC(), "items": []any{map[string]any{"kind": "operation", "id": id, "state": "future_state", "created_at": time.Now().UTC(), "payload": map[string]any{"secret": "private"}}}, "next_cursor": nil, "total": nil})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"source": "core", "observed_at": time.Now().UTC().Add(-16 * time.Minute), "installation_id": id, "module_enabled": false, "paused": false, "authorization_state": "valid", "webhook_state": "active", "events": map[string]any{"states": map[string]int{"pending": 0}}, "results": map[string]any{"states": map[string]int{}}, "operations": map[string]int{"future_state": 2}, "historical_gaps": 0, "client_secret": "must-drop"})
	}))
	defer server.Close()
	c, e := New(Options{BaseURL: server.URL, Token: "fixture", Timeout: time.Second})
	if e != nil {
		t.Fatal(e)
	}
	obs, e := c.GetDistribution(context.Background(), adapter.Actor{Value: "employee:test"}, id)
	if e != nil {
		t.Fatal(e)
	}
	if obs.Freshness != "stale" || obs.Data.ModuleEnabled || obs.Data.Events.States[0].Count != 0 || obs.Data.Operations[0].State != "unknown" || obs.Data.Operations[0].Raw != "future_state" {
		t.Fatalf("bad observation %+v", obs)
	}
	trace, e := c.GetDistributionTrace(context.Background(), adapter.Actor{Value: "employee:test"}, id, adapter.DistributionFilter{Reference: id, PageFilter: adapter.PageFilter{Limit: 1, Cursor: "testcursor"}})
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(trace)
	if strings.Contains(string(raw), "secret") || strings.Contains(string(raw), "payload") || trace.Data.Items[0].State != "unknown" {
		t.Fatalf("unsafe trace %s", raw)
	}
}
func TestDistributionFailuresStayUnavailableOrUnknown(t *testing.T) {
	for _, tc := range []struct {
		name        string
		status      int
		body        string
		slow        bool
		wantUnknown bool
	}{
		{"old capability", 404, `{}`, false, true}, {"outage", 500, `{}`, false, false}, {"missing facts", 200, `{"installation_id":"d1500000-0000-4000-8000-000000000001","observed_at":"2026-10-03T00:00:00Z"}`, false, false}, {"timeout", 200, `{}`, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if tc.slow {
					time.Sleep(30 * time.Millisecond)
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer s.Close()
			c, e := New(Options{BaseURL: s.URL, Token: "fixture", Timeout: 5 * time.Millisecond})
			if e != nil {
				t.Fatal(e)
			}
			obs, e := c.GetDistribution(t.Context(), adapter.Actor{}, "d1500000-0000-4000-8000-000000000001")
			if tc.wantUnknown {
				if e != nil || obs.Freshness != "unknown" || obs.Data != nil {
					t.Fatalf("unknown=%+v %v", obs, e)
				}
			} else if e == nil {
				t.Fatalf("must fail, got %+v", obs)
			}
		})
	}
}
func TestDistributionValidation(t *testing.T) {
	for _, tc := range []struct {
		name string
		item adapter.DistributionTraceItem
	}{
		{"missing", adapter.DistributionTraceItem{}}, {"future", adapter.DistributionTraceItem{ID: "1", Kind: "operation", State: "queued", CreatedAt: time.Now().Add(time.Hour)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if validateDistributionItem(tc.item) == nil {
				t.Fatal("accepted malformed")
			}
		})
	}
	if validDistributionCounts(map[string]int{"pending": -1}) {
		t.Fatal("accepted negative count")
	}
	if adapter.MapDistributionState("Bearer secret credential").Raw != "redacted" {
		t.Fatal("unsafe unknown raw")
	}
}

func TestDistributionCapableSourcePreservesScopedNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/admin/v1/backend" {
			_ = json.NewEncoder(w).Encode(map[string]any{"backend": "core", "observed_at": time.Now().UTC(), "capabilities": []string{"distribution-read"}})
			return
		}
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"message":"not found"}}`))
	}))
	defer server.Close()
	c, e := New(Options{BaseURL: server.URL, Token: "fixture", Timeout: time.Second})
	if e != nil {
		t.Fatal(e)
	}
	if _, e := c.GetDistribution(t.Context(), adapter.Actor{}, "d1500000-0000-4000-8000-000000000009"); !errors.Is(e, adapter.ErrNotFound) {
		t.Fatalf("summary scoped error=%v", e)
	}
	if _, e := c.GetDistributionTrace(t.Context(), adapter.Actor{}, "d1500000-0000-4000-8000-000000000009", adapter.DistributionFilter{}); !errors.Is(e, adapter.ErrNotFound) {
		t.Fatalf("trace scoped error=%v", e)
	}
}

func TestDistributionCapabilityProbePreservesSourceFailures(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		slow   bool
		want   error
	}{
		{"unavailable", 503, `{}`, false, adapter.ErrUnavailable},
		{"timeout", 200, `{}`, true, adapter.ErrTimeout},
		{"malformed health", 200, `{}`, false, adapter.ErrUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/admin/v1/backend" {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				if tc.slow {
					<-r.Context().Done()
					return
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			client, err := New(Options{BaseURL: server.URL, Token: "fixture", Timeout: time.Second})
			if err != nil {
				t.Fatal(err)
			}
			id := "d1500000-0000-4000-8000-000000000001"
			if _, err = client.GetDistribution(t.Context(), adapter.Actor{}, id); !errors.Is(err, tc.want) {
				t.Fatalf("summary must preserve source error: %v", err)
			}
			if _, err = client.GetDistributionTrace(t.Context(), adapter.Actor{}, id, adapter.DistributionFilter{}); !errors.Is(err, tc.want) {
				t.Fatalf("trace must preserve source error: %v", err)
			}
		})
	}
}
