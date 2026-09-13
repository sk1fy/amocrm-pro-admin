package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sk1fy/amocrm-pro-admin/internal/accounts"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/catalog"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/operations"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
	"github.com/sk1fy/amocrm-pro-admin/internal/views"
)

func TestViewerReadsAccountsWithFixtureAdapter(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	fx := fixture.Demo("fixture")
	router := testRouterWithRegistry(t, pool, 10, catalog.FromBackends(fixture.Unavailable("core"), fx))
	ctx := context.Background()
	store := employees.NewStore(pool, 2*time.Second)
	viewer := createEmployee(t, ctx, store, "viewer@example.invalid", "Viewer", rbac.RoleViewer)
	loginRec := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(viewer.Email, testPassword), "")
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login=%d %s", loginRec.Code, loginRec.Body.String())
	}
	cookie := sessionCookie(t, loginRec)

	list := doJSON(t, router, http.MethodGet, "/api/v1/accounts?q=91000002", "", cookie)
	if list.Code != http.StatusOK {
		t.Fatalf("list=%d %s", list.Code, list.Body.String())
	}
	assertNoSecretJSONKeys(t, list.Body.Bytes())
	var listBody struct {
		Items []struct {
			AccountID   string `json:"account_id"`
			State       string `json:"state"`
			Connections []struct {
				ConnectionID    string `json:"connection_id"`
				IntegrationCode string `json:"integration_code"`
				State           string `json:"state"`
			} `json:"connections"`
		} `json:"items"`
		Sources []struct {
			Backend string `json:"backend"`
			Status  string `json:"status"`
		} `json:"sources"`
	}
	decodeBody(t, list, &listBody)
	if len(listBody.Items) != 1 || listBody.Items[0].AccountID != "91000002" {
		t.Fatalf("items=%+v", listBody.Items)
	}
	if listBody.Items[0].State != adapter.AccountPartial {
		t.Fatalf("state=%s", listBody.Items[0].State)
	}
	if len(listBody.Items[0].Connections) != 2 {
		t.Fatalf("connections=%+v", listBody.Items[0].Connections)
	}
	byBackend := map[string]string{}
	for _, source := range listBody.Sources {
		byBackend[source.Backend] = source.Status
	}
	if byBackend["core"] != adapter.SourceUnavailable || byBackend["fixture"] != adapter.SourceAvailable {
		t.Fatalf("sources=%v", byBackend)
	}

	card := doJSON(t, router, http.MethodGet, "/api/v1/accounts/91000002", "", cookie)
	if card.Code != http.StatusOK {
		t.Fatalf("card=%d %s", card.Code, card.Body.String())
	}
	assertNoSecretJSONKeys(t, card.Body.Bytes())
	var cardBody struct {
		Connections []struct {
			ObservedAt string `json:"observed_at"`
			Freshness  string `json:"freshness"`
		} `json:"connections"`
	}
	decodeBody(t, card, &cardBody)
	if len(cardBody.Connections) == 0 {
		t.Fatal("card has no connections")
	}
	for _, observation := range cardBody.Connections {
		if observation.ObservedAt == "" || observation.Freshness == "" {
			t.Fatalf("connection observation=%+v", observation)
		}
	}

	filtered := doJSON(t, router, http.MethodGet, "/api/v1/accounts?problem=job_failures&limit=1", "", cookie)
	if filtered.Code != http.StatusOK {
		t.Fatalf("filtered=%d %s", filtered.Code, filtered.Body.String())
	}
	var filteredBody struct {
		Items []struct {
			AccountID string `json:"account_id"`
		} `json:"items"`
		Total *int `json:"total"`
	}
	decodeBody(t, filtered, &filteredBody)
	if len(filteredBody.Items) != 1 {
		t.Fatalf("problem filter=%s", filtered.Body.String())
	}
	if filteredBody.Total != nil {
		t.Fatalf("total must be withheld while a source is unavailable: %v", *filteredBody.Total)
	}

	onlyAvailable := testRouterWithRegistry(t, pool, 10, catalog.FromBackends(fx))
	exact := doJSON(t, onlyAvailable, http.MethodGet, "/api/v1/accounts?problem=job_failures&limit=1", "", cookie)
	if exact.Code != http.StatusOK {
		t.Fatalf("exact=%d %s", exact.Code, exact.Body.String())
	}
	var exactBody struct {
		Items []struct {
			AccountID string `json:"account_id"`
		} `json:"items"`
		Total *int `json:"total"`
	}
	decodeBody(t, exact, &exactBody)
	if len(exactBody.Items) != 1 || exactBody.Total == nil || *exactBody.Total != 2 {
		t.Fatalf("exact total=%s", exact.Body.String())
	}

	clamped := doJSON(t, onlyAvailable, http.MethodGet, "/api/v1/accounts?limit=101", "", cookie)
	if clamped.Code != http.StatusOK {
		t.Fatalf("clamped=%d %s", clamped.Code, clamped.Body.String())
	}
	var clampedBody struct {
		Items []struct {
			AccountID string `json:"account_id"`
		} `json:"items"`
		Total *int `json:"total"`
	}
	decodeBody(t, clamped, &clampedBody)
	if len(clampedBody.Items) > 100 {
		t.Fatalf("limit was not clamped: %d", len(clampedBody.Items))
	}
	if clampedBody.Total == nil || *clampedBody.Total != 6 {
		t.Fatalf("total=%v", clampedBody.Total)
	}

	operations := doJSON(t, router, http.MethodGet, "/api/v1/operations/jobs?limit=50", "", cookie)
	var operationsBody struct {
		Items []struct {
			ID        string `json:"id"`
			AccountID string `json:"account_id"`
		} `json:"items"`
	}
	decodeBody(t, operations, &operationsBody)
	if len(operationsBody.Items) == 0 {
		t.Fatal("no jobs returned")
	}
	withAccount := 0
	for _, item := range operationsBody.Items {
		if item.AccountID != "" {
			withAccount++
		}
	}
	if withAccount == 0 {
		t.Fatalf("jobs account_id=%s", operations.Body.String())
	}
	assertNoSecretJSONKeys(t, operations.Body.Bytes())

	conn := doJSON(t, router, http.MethodGet, "/api/v1/connections/fixture/f1a00000-0000-4000-8000-000000000003", "", cookie)
	if conn.Code != http.StatusOK {
		t.Fatalf("connection=%d %s", conn.Code, conn.Body.String())
	}
	assertNoSecretJSONKeys(t, conn.Body.Bytes())
	var connBody map[string]any
	if err := json.Unmarshal(conn.Body.Bytes(), &connBody); err != nil {
		t.Fatal(err)
	}
	authObs, _ := connBody["authorization"].(map[string]any)
	if authObs == nil {
		t.Fatal("missing authorization observation")
	}

	for _, path := range []string{
		"/api/v1/accounts?q=https://fixture-two.amocrm.test/leads/detail/123",
		"/api/v1/accounts/91000002/history",
		"/api/v1/connections/fixture/f1a00000-0000-4000-8000-000000000003/jobs",
		"/api/v1/connections/fixture/f1a00000-0000-4000-8000-000000000003/audit",
		"/api/v1/catalog",
		"/api/v1/integrations",
		"/api/v1/operations/jobs",
		"/api/v1/system/backends",
	} {
		rec := doJSON(t, router, http.MethodGet, path, "", cookie)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s=%d %s", path, rec.Code, rec.Body.String())
		}
		assertNoSecretJSONKeys(t, rec.Body.Bytes())
	}

	page := doJSON(t, router, http.MethodGet, "/api/v1/accounts?limit=1", "", cookie)
	if page.Code != http.StatusOK {
		t.Fatalf("page=%d %s", page.Code, page.Body.String())
	}
	var pageBody sourcedListResponse
	decodeBody(t, page, &pageBody)
	if pageBody.NextCursor == nil {
		t.Fatal("expected next cursor")
	}
}

func testRouterWithRegistry(t *testing.T, pool *pgxpool.Pool, loginRate int, registry *catalog.Registry) http.Handler {
	t.Helper()
	if registry == nil {
		registry = catalog.FromBackends()
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	auditStore := audit.NewStore(pool, 2*time.Second)
	return New(Dependencies{
		Operations:     operations.New(operations.NewStore(pool, 2*time.Second, auditStore), registry, employees.NewStore(pool, 2*time.Second)),
		Employees:      employees.NewStore(pool, 2*time.Second),
		Sessions:       auth.NewService(pool, 2*time.Second, 12*time.Hour, 2*time.Hour, false),
		Audit:          auditStore,
		Views:          views.NewStore(pool, 2*time.Second),
		Limiter:        auth.NewLimiter(loginRate),
		PublicOrigin:   testOrigin,
		GrafanaBaseURL: "https://grafana.example.invalid",
		Logger:         logger,
		Timeout:        2 * time.Second,
		Registry:       registry,
		Accounts:       accounts.New(registry.Backends(), auditStore),
	})
}

func TestAccountHistoryIncludesOlderAdminAuditAndJobsPages(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := t.Context()
	store := employees.NewStore(pool, 2*time.Second)
	viewer := createEmployee(t, ctx, store, "paging@example.invalid", "Paging", rbac.RoleViewer)
	data := fixture.Data{Accounts: []adapter.Account{{AccountID: 1, Connections: []adapter.ConnectionSummary{{ID: "c", AccountID: 1, IntegrationID: "11111111-1111-4111-8111-111111111111"}}}}, ConnectionJobs: map[string][]adapter.Job{}}
	for i := 0; i < 27; i++ {
		data.ConnectionJobs["c"] = append(data.ConnectionJobs["c"], adapter.Job{ID: fmt.Sprintf("job-%03d", i), UpdatedAt: time.Now().Add(-time.Duration(i) * time.Minute), Type: "example", Status: adapter.MapJobStatus("failed")})
	}
	auditStore := audit.NewStore(pool, 2*time.Second)
	for i := 0; i < 27; i++ {
		if err := auditStore.Record(ctx, audit.Event{Action: fmt.Sprintf("test.%02d", i), ObjectRef: "account:1"}); err != nil {
			t.Fatal(err)
		}
	}
	router := testRouterWithRegistry(t, pool, 10, catalog.FromBackends(fixture.New(fixture.Options{Code: "core", Data: data})))
	loginRec := doJSON(t, router, http.MethodPost, "/api/v1/auth/login", loginBody(viewer.Email, testPassword), "")
	cookie := sessionCookie(t, loginRec)
	for _, kind := range []string{"history", "jobs"} {
		t.Run(kind, func(t *testing.T) {
			cursor := ""
			seen := map[string]bool{}
			for page := 0; page < 8; page++ {
				rec := doJSON(t, router, http.MethodGet, "/api/v1/accounts/1/"+kind+"?limit=7&cursor="+url.QueryEscape(cursor), "", cookie)
				if rec.Code != 200 {
					t.Fatalf("%s: %d %s", kind, rec.Code, rec.Body.String())
				}
				assertNoSecretJSONKeys(t, rec.Body.Bytes())
				var body struct {
					Items []struct {
						ID      string `json:"id"`
						Action  string `json:"action"`
						Backend string `json:"backend"`
					} `json:"items"`
					Next *string `json:"next_cursor"`
				}
				decodeBody(t, rec, &body)
				if len(body.Items) > 7 {
					t.Fatal("too many rows")
				}
				for _, item := range body.Items {
					key := item.Action
					if kind == "jobs" {
						key = item.ID
						if item.Backend != "core" {
							t.Fatal("missing backend")
						}
					}
					if seen[key] {
						t.Fatalf("duplicate %s", key)
					}
					seen[key] = true
				}
				if body.Next == nil {
					break
				}
				cursor = *body.Next
			}
			if len(seen) != 27 {
				t.Fatalf("%s lost records: %d", kind, len(seen))
			}
		})
	}
	rec := doJSON(t, router, http.MethodGet, "/api/v1/accounts?backend=core&integration_id=11111111-1111-4111-8111-111111111111", "", cookie)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"account_id":"1"`) {
		t.Fatalf("integration filter: %s", rec.Body.String())
	}
}
