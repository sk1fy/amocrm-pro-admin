package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientIPUsesTrustProxyFlag(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = "172.18.0.5:3456"
	request.Header.Set("X-Forwarded-For", "203.0.113.7")

	if got := (&api{}).clientIP(request); got != "172.18.0.5" {
		t.Fatalf("clientIP() = %q, want peer address", got)
	}
	if got := (&api{trustProxy: true}).clientIP(request); got != "203.0.113.7" {
		t.Fatalf("clientIP() = %q, want forwarded address", got)
	}
}
