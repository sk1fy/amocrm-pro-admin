package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
	"github.com/sk1fy/amocrm-pro-admin/internal/catalog"
)

type pagedRow struct {
	Backend string `json:"backend"`
	ID      string `json:"id"`
}

// walkSourcedList follows next_cursor with limit=1 and returns how many times
// each row was shown.
func walkSourcedList(t *testing.T, handler http.HandlerFunc, path string, key func(pagedRow) string) map[string]int {
	t.Helper()
	seen := map[string]int{}
	cursor := ""
	for page := 1; ; page++ {
		if page > 100 {
			t.Fatal("pagination did not end")
		}
		query := url.Values{"limit": {"1"}}
		if cursor != "" {
			query.Set("cursor", cursor)
		}
		recorder := httptest.NewRecorder()
		handler(recorder, httptest.NewRequest(http.MethodGet, path+"?"+query.Encode(), nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("page %d status %d: %s", page, recorder.Code, recorder.Body)
		}
		var body struct {
			Items      []pagedRow `json:"items"`
			NextCursor *string    `json:"next_cursor"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		for _, item := range body.Items {
			seen[key(item)]++
		}
		if body.NextCursor == nil {
			return seen
		}
		cursor = *body.NextCursor
	}
}

func TestListIntegrationsDoesNotRestartExhaustedSource(t *testing.T) {
	h := &api{registry: catalog.FromBackends(fixture.Demo("core"), fixture.Module("fixture"))}
	seen := walkSourcedList(t, h.listIntegrations, "/api/v1/integrations", func(row pagedRow) string {
		return row.Backend + "/" + row.ID
	})
	for key, n := range seen {
		if n != 1 {
			t.Fatalf("%s shown %d times", key, n)
		}
	}
	if len(seen) < 2 {
		t.Fatalf("rows %v", seen)
	}
}

func TestListJobsDoesNotRestartExhaustedSource(t *testing.T) {
	small := fixture.New(fixture.Options{Code: "small", Data: fixture.Data{Jobs: []adapter.JobDetail{{Job: adapter.Job{ID: "small-1", Status: adapter.State{Canonical: "succeeded"}}}}}})
	h := &api{registry: catalog.FromBackends(fixture.Demo("core"), small)}
	seen := walkSourcedList(t, h.listJobs, "/api/v1/operations/jobs", func(row pagedRow) string { return row.ID })
	for key, n := range seen {
		if n != 1 {
			t.Fatalf("%s shown %d times", key, n)
		}
	}
	if seen["small-1"] != 1 || len(seen) < 3 {
		t.Fatalf("rows %v", fmt.Sprint(seen))
	}
}
