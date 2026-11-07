package auth

import (
	"context"
	"errors"
	"net/http"

	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

type principalKey struct{}

func PrincipalFromContext(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(principalKey{}).(Principal)
	return principal, ok
}

// ContextWithPrincipal stores the authenticated principal; Middleware uses it
// and tests of downstream authorization use it directly.
func ContextWithPrincipal(ctx context.Context, principal Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, principal)
}

func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(CookieName)
		if err != nil || cookie.Value == "" {
			httpx.WriteError(w, r, httpx.Unauthenticated("authentication required"))
			return
		}
		principal, err := s.Lookup(r.Context(), cookie.Value)
		if err != nil {
			if errors.Is(err, ErrUnauthenticated) {
				httpx.WriteError(w, r, httpx.Unauthenticated("authentication required"))
				return
			}
			httpx.WriteError(w, r, httpx.Internal())
			return
		}
		next.ServeHTTP(w, r.WithContext(ContextWithPrincipal(r.Context(), principal)))
	})
}
