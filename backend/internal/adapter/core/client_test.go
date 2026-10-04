package core

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

func TestClientMapsStatusesAndUnknown(t *testing.T) {
	var sawAuth, sawActor bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("authorization=%q", got)
		} else {
			sawAuth = true
		}
		if got := r.Header.Get("X-Admin-Actor"); got != "employee:11111111-1111-4111-8111-111111111111" {
			t.Errorf("actor=%q", got)
		} else {
			sawActor = true
		}
		switch r.URL.Path {
		case "/admin/v1/accounts":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{
				"source":"core","observed_at":"2026-09-12T10:00:00Z",
				"items":[{"account_id":91000002,"domains":["fixture-two.amocrm.test"],
					"last_activity_at":"2026-09-12T10:00:00Z","origin":"fixture",
					"installations":[
						{"id":"a","integration_id":"i1","integration_code":"widget-a","status":"reauth_required"},
						{"id":"b","integration_id":"i2","integration_code":"widget-b","status":"nope"}
					]}],
				"next_cursor":"next-core"}`)
		case "/admin/v1/installations/missing":
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":{"code":"not_found","message":"installation not found","request_id":"x"}}`)
		case "/admin/v1/backend":
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"error":{"code":"unauthenticated","message":"authentication required"}}`)
		default:
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(w, `{"error":{"code":"internal","message":"internal error"}}`)
		}
	}))
	t.Cleanup(server.Close)

	client := testClient(t, server.URL)
	ctx := context.Background()
	actor := adapter.Actor{Value: "employee:11111111-1111-4111-8111-111111111111"}

	obs, err := client.ListAccounts(ctx, actor, adapter.AccountFilter{Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	if obs.Data == nil || len(obs.Data.Items) != 1 || obs.Data.NextCursor == nil || *obs.Data.NextCursor != "next-core" {
		t.Fatalf("page=%+v", obs.Data)
	}
	conns := obs.Data.Items[0].Connections
	if conns[0].Status.Canonical != adapter.StatusReauthRequired || conns[1].Status.Canonical != adapter.StateUnknown || conns[1].Status.Raw != "nope" {
		t.Fatalf("connections=%+v", conns)
	}

	_, err = client.GetConnection(ctx, actor, "missing")
	if !errors.Is(err, adapter.ErrNotFound) {
		t.Fatalf("not found: %v", err)
	}
	if strings.Contains(err.Error(), "test-token") {
		t.Fatalf("token leaked: %v", err)
	}

	_, err = client.Health(ctx, actor)
	if !errors.Is(err, adapter.ErrUnavailable) {
		t.Fatalf("401: %v", err)
	}

	_, err = client.GetJob(ctx, actor, "x")
	if !errors.Is(err, adapter.ErrUnavailable) {
		t.Fatalf("5xx: %v", err)
	}

	if !sawAuth || !sawActor {
		t.Fatalf("headers auth=%t actor=%t", sawAuth, sawActor)
	}
}

func TestClientTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		time.Sleep(50 * time.Millisecond)
	}))
	t.Cleanup(server.Close)
	client, err := New(Options{
		Code: "core", BaseURL: server.URL, Token: "test-token", Timeout: 10 * time.Millisecond,
		HTTPClient: &http.Client{Timeout: 10 * time.Millisecond},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Health(context.Background(), adapter.Actor{Value: "employee:test"})
	if !errors.Is(err, adapter.ErrTimeout) {
		t.Fatalf("timeout: %v", err)
	}
	if strings.Contains(err.Error(), "test-token") {
		t.Fatalf("token leaked: %v", err)
	}
}

func TestClientJSONUsesCredentialVersion(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"source":"core","observed_at":"2026-09-12T10:00:00Z",
			"installation":{"id":"a","integration_id":"i","integration_code":"w","account_id":1,
				"account_domain":"fixture.amocrm.test","status":"active","origin":"fixture",
				"created_at":"2026-09-12T10:00:00Z","updated_at":"2026-09-12T10:00:00Z"},
			"authorization":{"state":"valid","credentials_present":true,"credential_version":3,"unverified":true},
			"webhook":{"status":"active","events":["add_lead"],"confirmed_destinations":1},
			"grants":[{"service":"lead-status","enabled":true}],
			"activity":{"pilot":"enabled"}
		}`)
	}))
	t.Cleanup(server.Close)
	client := testClient(t, server.URL)
	obs, err := client.GetConnection(context.Background(), adapter.Actor{Value: "employee:test"}, "a")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(obs.Data.Authorization)
	if strings.Contains(strings.ToLower(string(raw)), "token") {
		t.Fatalf("token substring in authorization json: %s", raw)
	}
	if obs.Data.Authorization.CredentialVersion != 3 {
		t.Fatalf("credential_version=%d", obs.Data.Authorization.CredentialVersion)
	}
	if obs.Data.Grants[0].State.Canonical != adapter.GrantGranted {
		t.Fatalf("grant=%+v", obs.Data.Grants[0])
	}
}

func TestClientPreservesWebhookRegistryCount(t *testing.T) {
	for _, tc := range []struct {
		name  string
		field string
		want  *int
	}{
		{name: "omitted"},
		{name: "null", field: `,"confirmed_destinations":null`},
		{name: "zero", field: `,"confirmed_destinations":0`, want: new(int)},
		{name: "positive", field: `,"confirmed_destinations":2`, want: func() *int { n := 2; return &n }()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"source":"core","observed_at":"2026-09-20T10:00:00Z",`+
					`"installation":{"status":"active"},"webhook":{"status":"active","events":[]`+tc.field+`}}`)
			}))
			t.Cleanup(server.Close)
			client := testClient(t, server.URL)
			obs, err := client.GetConnection(context.Background(), adapter.Actor{Value: "employee:test"}, "fixture-installation")
			if err != nil {
				t.Fatal(err)
			}
			if obs.Data == nil {
				t.Fatal("missing connection")
			}
			got := obs.Data.Webhook.ConfirmedDestinations
			if tc.want == nil {
				if got != nil {
					t.Fatalf("missing count became %d", *got)
				}
			} else if got == nil || *got != *tc.want {
				t.Fatalf("count=%v want=%d", got, *tc.want)
			}
		})
	}
}

func testClient(t *testing.T, baseURL string) *Client {
	t.Helper()
	client, err := New(Options{Code: "core", BaseURL: baseURL, Token: "test-token", Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func TestClientForwardsRequestIDFromHttpx(t *testing.T) {
	var got string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("X-Request-ID")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"source":"core","observed_at":"2026-09-12T10:00:00Z","backend":"core","revision":"dev","contract_version":"v1","capabilities":[]}`)
	}))
	t.Cleanup(server.Close)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	req.Header.Set("X-Request-ID", id.String())
	rec := httptest.NewRecorder()
	handler := httpx.RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		client := testClient(t, server.URL)
		_, err := client.Health(r.Context(), adapter.Actor{Value: "employee:test"})
		if err != nil {
			t.Error(err)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	handler.ServeHTTP(rec, req)
	if got != id.String() {
		t.Fatalf("forwarded request id=%q", got)
	}
}
