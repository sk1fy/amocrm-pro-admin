package auth

import (
	"net/http"

	"github.com/sk1fy/amocrm-pro-admin/internal/platform/config"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

func CSRF(publicOrigin string) func(http.Handler) http.Handler {
	expectedOrigin := config.NormalizeOrigin(publicOrigin)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			if r.Header.Get("X-Requested-With") != RequestedWith {
				httpx.WriteError(w, r, httpx.Forbidden("csrf check failed"))
				return
			}
			if config.NormalizeOrigin(r.Header.Get("Origin")) != expectedOrigin {
				httpx.WriteError(w, r, httpx.Forbidden("csrf check failed"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
