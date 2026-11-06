package core

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

const crmConnectionJSON = `"connection":{"installation_id":"f1a00000-0000-4000-8000-000000000001","integration_id":"11111111-1111-4111-8111-111111111111","integration_code":"widget-fixture-a"}`

func crmUsersClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	admin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("crm users must not use the admin listener: %s", r.URL.Path)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(admin.Close)
	crm := httptest.NewServer(handler)
	t.Cleanup(crm.Close)
	client, err := New(Options{Code: "core", BaseURL: admin.URL, Token: "test-token", Timeout: time.Second, CRMBaseURL: crm.URL})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func TestCRMUsersCapabilityNeedsListener(t *testing.T) {
	client, err := New(Options{Code: "core", BaseURL: "http://core-admin:8083", Token: "t"})
	if err != nil {
		t.Fatal(err)
	}
	if client.Capabilities().CRMUsers {
		t.Fatal("crm-users must stay off without crm_base_url")
	}
	if _, err := client.GetCRMUsers(context.Background(), adapter.Actor{}, 1); !errors.Is(err, adapter.ErrUnsupported) {
		t.Fatalf("err=%v", err)
	}
	client, err = New(Options{Code: "core", BaseURL: "http://core-admin:8083", Token: "t", CRMBaseURL: "http://core-admin-crm:8085"})
	if err != nil {
		t.Fatal(err)
	}
	if !client.Capabilities().CRMUsers || client.CRMUsersTimeout() != DefaultCRMTimeout {
		t.Fatalf("caps=%+v timeout=%s", client.Capabilities(), client.CRMUsersTimeout())
	}
}

func TestCRMUsersOptionsValidation(t *testing.T) {
	for name, opts := range map[string]Options{
		"relative url":         {CRMBaseURL: "core-admin-crm:8085"},
		"timeout without url":  {CRMTimeout: time.Second},
		"timeout above budget": {CRMBaseURL: "http://core-admin-crm:8085", CRMTimeout: MaxCRMTimeout + time.Second},
		"negative timeout":     {CRMBaseURL: "http://core-admin-crm:8085", CRMTimeout: -time.Second},
	} {
		opts.BaseURL, opts.Token = "http://core-admin:8083", "t"
		if _, err := New(opts); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestCRMUsersMapsSnapshot(t *testing.T) {
	client := crmUsersClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin/v1/accounts/91000001/crm-users" || r.URL.RawQuery != "" {
			t.Errorf("path=%s query=%s", r.URL.Path, r.URL.RawQuery)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("X-Admin-Actor") != "employee:test" {
			t.Errorf("headers=%v", r.Header)
		}
		_, _ = io.WriteString(w, `{"source":"core","observed_at":"2026-11-06T10:00:00Z","account_id":91000001,
			"state":"ok","retry_after_seconds":null,`+crmConnectionJSON+`,"fresh_until":"2026-11-06T10:05:00Z",
			"items":[{"id":501,"name":"Fixture User A","is_active":true,"is_admin":true},{"id":507,"name":"Fixture User G","is_active":false,"is_admin":false}],"total":2}`)
	})
	obs, err := client.GetCRMUsers(context.Background(), adapter.Actor{Value: "employee:test"}, 91000001)
	if err != nil || obs.Data == nil {
		t.Fatalf("err=%v", err)
	}
	data := *obs.Data
	if obs.Freshness != adapter.FreshnessFresh || !obs.ObservedAt.Equal(time.Date(2026, 11, 6, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("observation=%+v", obs)
	}
	if data.State.Canonical != adapter.CRMUsersOK || data.Total == nil || *data.Total != 2 || len(data.Users) != 2 {
		t.Fatalf("data=%+v", data)
	}
	if data.Users[0] != (adapter.CRMUser{ID: 501, Name: "Fixture User A", IsActive: true, IsAdmin: true}) {
		t.Fatalf("user=%+v", data.Users[0])
	}
	if data.Connection == nil || data.Connection.IntegrationCode != "widget-fixture-a" || data.FreshUntil == nil {
		t.Fatalf("connection=%+v fresh_until=%v", data.Connection, data.FreshUntil)
	}
}

func TestCRMUsersKeepsUnknownListUnknown(t *testing.T) {
	cases := map[string]struct {
		body       string
		state, raw string
		retry      time.Duration
		connection bool
	}{
		"rate limited": {
			body:  `"state":"rate_limited","retry_after_seconds":30,` + crmConnectionJSON + `,"fresh_until":null,"items":null,"total":null`,
			state: adapter.CRMUsersRateLimited, retry: 30 * time.Second, connection: true,
		},
		"no connection": {
			body:  `"state":"no_authorized_connection","retry_after_seconds":null,"connection":null,"fresh_until":null,"items":null,"total":null`,
			state: adapter.CRMUsersNoAuthorizedConnection,
		},
		"future state with stray items": {
			body:  `"state":"throttled","retry_after_seconds":null,` + crmConnectionJSON + `,"fresh_until":null,"items":[{"id":1,"name":"x","is_active":true,"is_admin":false}],"total":1`,
			state: adapter.StateUnknown, raw: "throttled", connection: true,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			client := crmUsersClient(t, func(w http.ResponseWriter, _ *http.Request) {
				_, _ = io.WriteString(w, `{"source":"core","observed_at":"2026-11-06T10:00:00Z","account_id":91000002,`+tc.body+`}`)
			})
			obs, err := client.GetCRMUsers(context.Background(), adapter.Actor{Value: "employee:test"}, 91000002)
			if err != nil || obs.Data == nil {
				t.Fatalf("err=%v", err)
			}
			data := *obs.Data
			if data.State.Canonical != tc.state || data.State.Raw != tc.raw || data.Users != nil || data.Total != nil || data.FreshUntil != nil {
				t.Fatalf("data=%+v", data)
			}
			if (data.Connection != nil) != tc.connection {
				t.Fatalf("connection=%+v", data.Connection)
			}
			if tc.retry == 0 && data.RetryAfter != nil || tc.retry != 0 && (data.RetryAfter == nil || *data.RetryAfter != tc.retry) {
				t.Fatalf("retry_after=%v", data.RetryAfter)
			}
		})
	}
}

func TestCRMUsersRejectsInvalidAnswers(t *testing.T) {
	ok := `"state":"ok","retry_after_seconds":null,` + crmConnectionJSON + `,"fresh_until":"2026-11-06T10:05:00Z",`
	for name, body := range map[string]string{
		"other account":    `"account_id":91000009,` + ok + `"items":[],"total":0`,
		"ok without list":  `"account_id":91000001,` + ok + `"items":null,"total":null`,
		"total mismatch":   `"account_id":91000001,` + ok + `"items":[],"total":3`,
		"invalid user id":  `"account_id":91000001,` + ok + `"items":[{"id":0,"name":"x","is_active":true,"is_admin":false}],"total":1`,
		"ok without owner": `"account_id":91000001,"state":"ok","retry_after_seconds":null,"connection":null,"fresh_until":null,"items":[],"total":0`,
	} {
		t.Run(name, func(t *testing.T) {
			client := crmUsersClient(t, func(w http.ResponseWriter, _ *http.Request) {
				_, _ = io.WriteString(w, `{"source":"core","observed_at":"2026-11-06T10:00:00Z",`+body+`}`)
			})
			_, err := client.GetCRMUsers(context.Background(), adapter.Actor{Value: "employee:test"}, 91000001)
			if !errors.Is(err, adapter.ErrUnavailable) {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestCRMUsersEmptyAccountListIsKnown(t *testing.T) {
	client := crmUsersClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"source":"core","observed_at":"2026-11-06T10:00:00Z","account_id":91000001,"state":"ok","retry_after_seconds":null,`+crmConnectionJSON+`,"fresh_until":"2026-11-06T10:05:00Z","items":[],"total":0}`)
	})
	obs, err := client.GetCRMUsers(context.Background(), adapter.Actor{Value: "employee:test"}, 91000001)
	if err != nil || obs.Data == nil || obs.Data.Users == nil || len(obs.Data.Users) != 0 || *obs.Data.Total != 0 {
		t.Fatalf("obs=%+v err=%v", obs, err)
	}
}

func TestCRMUsersMapsListenerFailures(t *testing.T) {
	client := crmUsersClient(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/91000404/crm-users") {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":{"code":"not_found","message":"account not found","request_id":"x","retryable":false}}`)
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
	})
	if _, err := client.GetCRMUsers(context.Background(), adapter.Actor{Value: "employee:test"}, 91000404); !errors.Is(err, adapter.ErrNotFound) {
		t.Fatalf("404 err=%v", err)
	}
	_, err := client.GetCRMUsers(context.Background(), adapter.Actor{Value: "employee:test"}, 91000001)
	if !errors.Is(err, adapter.ErrUnavailable) || strings.Contains(err.Error(), "test-token") {
		t.Fatalf("401 err=%v", err)
	}
}

func TestCRMUsersUsesOwnTimeout(t *testing.T) {
	crm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(80 * time.Millisecond)
		_, _ = io.WriteString(w, `{"source":"core","observed_at":"2026-11-06T10:00:00Z","account_id":1,"state":"no_authorized_connection","retry_after_seconds":null,"connection":null,"fresh_until":null,"items":null,"total":null}`)
	}))
	t.Cleanup(crm.Close)
	client, err := New(Options{Code: "core", BaseURL: "http://core-admin:8083", Token: "t", Timeout: 10 * time.Millisecond, CRMBaseURL: crm.URL, CRMTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetCRMUsers(context.Background(), adapter.Actor{Value: "employee:test"}, 1); err != nil {
		t.Fatalf("crm timeout must not inherit the admin timeout: %v", err)
	}
}
