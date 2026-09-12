package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
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
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestViewerReadsAccountsWithFixtureAdapter(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	fx := sampleFixture()
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
		Employees:    employees.NewStore(pool, 2*time.Second),
		Sessions:     auth.NewService(pool, 2*time.Second, 12*time.Hour, 2*time.Hour, false),
		Audit:        auditStore,
		Limiter:      auth.NewLimiter(loginRate),
		PublicOrigin: testOrigin,
		Logger:       logger,
		Timeout:      2 * time.Second,
		Registry:     registry,
		Accounts:     accounts.New(registry.Backends(), auditStore),
	})
}

func sampleFixture() *fixture.Adapter {
	now := time.Date(2026, 9, 12, 10, 0, 0, 0, time.UTC)
	reauth := adapter.ConnectionSummary{
		ID: "f1a00000-0000-4000-8000-000000000003", IntegrationID: "int-a",
		IntegrationCode: "fixture-widget-a", AccountID: 91000002,
		AccountDomain: "fixture-two.amocrm.test",
		Status:        adapter.State{Canonical: adapter.StatusReauthRequired},
		WebhookStatus: adapter.State{Canonical: adapter.StatusError},
		Origin:        adapter.OriginFixture, UpdatedAt: now,
	}
	active := adapter.ConnectionSummary{
		ID: "f1a00000-0000-4000-8000-000000000004", IntegrationID: "int-b",
		IntegrationCode: "fixture-widget-b", AccountID: 91000002,
		AccountDomain: "fixture-two.amocrm.test",
		Status:        adapter.State{Canonical: adapter.StatusActive},
		WebhookStatus: adapter.State{Canonical: adapter.StatusActive},
		Origin:        adapter.OriginFixture, UpdatedAt: now,
	}
	other := adapter.Account{
		AccountID: 91000001, Domains: []string{"fixture-one.amocrm.test"}, Origin: adapter.OriginFixture,
		LastActivityAt: now.Add(-time.Hour),
		Connections: []adapter.ConnectionSummary{{
			ID: "f1a00000-0000-4000-8000-000000000001", IntegrationCode: "fixture-widget-a",
			AccountID: 91000001, Status: adapter.State{Canonical: adapter.StatusActive}, Origin: adapter.OriginFixture,
		}},
	}
	return fixture.New(fixture.Options{
		Code: "fixture",
		Data: fixture.Data{
			Accounts: []adapter.Account{
				other,
				{
					AccountID: 91000002, Domains: []string{"fixture-two.amocrm.test"}, Origin: adapter.OriginFixture,
					LastActivityAt: now, Connections: []adapter.ConnectionSummary{reauth, active},
				},
			},
			ConnectionDetails: map[string]adapter.ConnectionDetail{
				reauth.ID: {
					Connection: reauth,
					Authorization: adapter.Authorization{
						State:              adapter.State{Canonical: adapter.AuthReauthRequired},
						CredentialsPresent: true, CredentialVersion: 3, Unverified: true,
					},
					Webhook:  adapter.Webhook{Status: adapter.State{Canonical: adapter.StatusError}, Events: []string{"add_lead"}},
					Grants:   []adapter.Grant{{Service: "lead-status", State: adapter.MapGrant(true)}},
					Activity: adapter.ActivityFacts{Pilot: adapter.State{Canonical: adapter.PilotDisabled}},
				},
			},
			Integrations: []adapter.Integration{{
				ID: "int-a", Code: "fixture-widget-a", ClientID: "client-a", Status: adapter.State{Canonical: adapter.StatusActive},
			}},
			Jobs: []adapter.JobDetail{{
				Job: adapter.Job{ID: "job-1", Type: "webhook.reconcile", Status: adapter.State{Canonical: adapter.StatusFailed}, CreatedAt: now, UpdatedAt: now},
			}},
			ConnectionJobs: map[string][]adapter.Job{
				reauth.ID: {{ID: "job-1", Type: "webhook.reconcile", Status: adapter.State{Canonical: adapter.StatusFailed}, CreatedAt: now, UpdatedAt: now}},
			},
			ConnectionAudit: map[string][]adapter.AuditEntry{
				reauth.ID: {{ID: 1, Action: "installation.reauth_required", ActorType: "fixture", CreatedAt: now, Metadata: []byte(`{"origin":"fixture"}`)}},
			},
		},
	})
}
