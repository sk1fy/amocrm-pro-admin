package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
)

func TestBrowserHostAudienceBoundary(t *testing.T) {
	for _, cfg := range []struct {
		name, scheme, port, alias string
	}{
		{"https", "https", "", ":443"},
		{"development_http", "http", "", ":80"},
		{"https_nondefault", "https", ":8443", ""},
		{"http_nondefault", "http", ":5173", ""},
	} {
		t.Run(cfg.name, func(t *testing.T) {
			adminOrigin := cfg.scheme + "://admin.example.invalid" + cfg.port
			managerOrigin := cfg.scheme + "://managers.example.invalid" + cfg.port
			router := New(Dependencies{
				Sessions:        auth.NewService(nil, time.Second, time.Hour, time.Hour, true),
				ManagerSessions: auth.NewManagerService(nil, time.Second, time.Hour, time.Hour, true),
				PublicOrigin:    adminOrigin,
				ManagerOrigin:   managerOrigin,
				Logger:          slog.New(slog.NewTextHandler(io.Discard, nil)),
			})
			for _, audience := range []struct {
				name, host, origin string
				own, other, logout apicontract.Route
			}{
				{"admin", "admin.example.invalid", adminOrigin, apicontract.Me, apicontract.ManagerMe, apicontract.AuthLogout},
				{"managers", "managers.example.invalid", managerOrigin, apicontract.ManagerMe, apicontract.Me, apicontract.ManagerLogout},
			} {
				t.Run(audience.name, func(t *testing.T) {
					request := func(host string, route apicontract.Route, origin, requestedWith string, want int) {
						t.Helper()
						req := httptest.NewRequest(route.Method, audience.origin+route.Path, nil)
						req.Host = host
						req.Header.Set("Origin", origin)
						req.Header.Set("X-Requested-With", requestedWith)
						req.Header.Set("X-Forwarded-Host", audience.host+cfg.port)
						req.Header.Set("Forwarded", "host="+audience.host+cfg.port)
						response := httptest.NewRecorder()
						router.ServeHTTP(response, req)
						if response.Code != want {
							t.Errorf("Host %q %s %s Origin %q requested-with %q = %d, want %d", host, route.Method, route.Path, origin, requestedWith, response.Code, want)
						}
					}
					hosts := []string{audience.host + cfg.port, strings.ToUpper(audience.host) + cfg.port}
					if cfg.alias != "" {
						hosts = append(hosts, audience.host+cfg.alias, strings.ToUpper(audience.host)+cfg.alias)
					}
					for _, host := range hosts {
						request(host, audience.own, "", "", http.StatusUnauthorized)
						request(host, audience.other, "", "", http.StatusNotFound)
						for _, csrf := range []struct {
							origin, requestedWith string
							want                  int
						}{
							{audience.origin, auth.RequestedWith, http.StatusUnauthorized},
							{"", auth.RequestedWith, http.StatusForbidden},
							{cfg.scheme + "://foreign.example.invalid", auth.RequestedWith, http.StatusForbidden},
							{audience.origin, "", http.StatusForbidden},
						} {
							request(host, audience.logout, csrf.origin, csrf.requestedWith, csrf.want)
						}
						if cfg.alias != "" {
							request(host, audience.logout, audience.origin+cfg.alias, auth.RequestedWith, http.StatusForbidden)
						}
					}
					for _, host := range []string{
						"", "foreign.example.invalid", audience.host + ".foreign.example.invalid",
						audience.host + ".", "user@" + audience.host, audience.host + ":",
						audience.host + ":443:443", audience.host + ":444", audience.host + ":0443",
						audience.host + ":80", audience.host + ":443",
					} {
						if host == audience.host+cfg.alias {
							continue
						}
						request(host, audience.own, "", "", http.StatusNotFound)
					}
					if cfg.port != "" {
						request(audience.host, audience.own, "", "", http.StatusNotFound)
					}
				})
			}
		})
	}
}

func TestBrowserHostsPreserveRawAuthority(t *testing.T) {
	for _, tc := range []struct {
		name, origin, host string
		want               int
	}{
		{"https", "https://admin.example.invalid", "AdMiN.example.invalid:443", http.StatusCreated},
		{"http", "http://admin.example.invalid", "AdMiN.example.invalid:80", http.StatusCreated},
		{"ipv6", "https://[::1]", "[::1]:443", http.StatusCreated},
		{"explicit_port", "https://admin.example.invalid:8443", "admin.example.invalid:8443", http.StatusCreated},
		{"explicit_default_is_exact", "https://admin.example.invalid:443", "admin.example.invalid", http.StatusNotFound},
		{"other_scheme", "ftp://admin.example.invalid", "admin.example.invalid:443", http.StatusNotFound},
		{"empty_origin", "", "", http.StatusNotFound},
		{"invalid_origin", "://", "", http.StatusNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			admin := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Host != tc.host {
					t.Errorf("Host rewritten to %q, want %q", r.Host, tc.host)
				}
				w.WriteHeader(http.StatusCreated)
			})
			manager := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				t.Error("request reached the other audience")
				w.WriteHeader(http.StatusAccepted)
			})
			request := httptest.NewRequest(http.MethodGet, "https://admin.example.invalid/api/v1/me", nil)
			request.Host = tc.host
			response := httptest.NewRecorder()
			browserHosts(tc.origin, "https://managers.example.invalid", admin, manager).ServeHTTP(response, request)
			if response.Code != tc.want {
				t.Errorf("Host %q = %d, want %d", tc.host, response.Code, tc.want)
			}
		})
	}
}
