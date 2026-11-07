package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestClientIPFrom(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		headers    map[string]string
		trustProxy bool
		want       string
	}{
		{
			name:       "remote addr without headers",
			remoteAddr: "198.51.100.10:2345",
			want:       "198.51.100.10",
		},
		{
			name:       "forwarded for single",
			remoteAddr: "172.18.0.5:3456",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.7"},
			trustProxy: true,
			want:       "203.0.113.7",
		},
		{
			name:       "forwarded for multiple picks rightmost added by proxy",
			remoteAddr: "172.18.0.5:3456",
			headers:    map[string]string{"X-Forwarded-For": "unknown, , 203.0.113.7, 198.51.100.23"},
			trustProxy: true,
			want:       "198.51.100.23",
		},
		{
			name:       "spoofed left entry is ignored",
			remoteAddr: "172.18.0.5:3456",
			headers:    map[string]string{"X-Forwarded-For": "192.0.2.1, 203.0.113.7"},
			trustProxy: true,
			want:       "203.0.113.7",
		},
		{
			name:       "garbage rightmost entry does not fall back to client entries",
			remoteAddr: "172.18.0.5:3456",
			headers: map[string]string{
				"X-Forwarded-For": "203.0.113.7, not-an-ip",
				"X-Real-IP":       "203.0.113.9",
			},
			trustProxy: true,
			want:       "172.18.0.5",
		},
		{
			name:       "empty rightmost entry falls back to remote addr",
			remoteAddr: "172.18.0.5:3456",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.7, "},
			trustProxy: true,
			want:       "172.18.0.5",
		},
		{
			name:       "forwarded for ipv6 with port",
			remoteAddr: "172.18.0.5:3456",
			headers:    map[string]string{"X-Forwarded-For": "192.0.2.1, [2001:db8::7]:4444"},
			trustProxy: true,
			want:       "2001:db8::7",
		},
		{
			name:       "forwarded for bare ipv6",
			remoteAddr: "172.18.0.5:3456",
			headers:    map[string]string{"X-Forwarded-For": "2001:db8::8"},
			trustProxy: true,
			want:       "2001:db8::8",
		},
		{
			name:       "forwarded for wins over real ip",
			remoteAddr: "172.18.0.5:3456",
			headers: map[string]string{
				"X-Forwarded-For": "203.0.113.7",
				"X-Real-IP":       "192.0.2.1",
			},
			trustProxy: true,
			want:       "203.0.113.7",
		},
		{
			name:       "forwarded for strips port",
			remoteAddr: "172.18.0.5:3456",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.7:5555"},
			trustProxy: true,
			want:       "203.0.113.7",
		},
		{
			name:       "real ip fallback",
			remoteAddr: "172.18.0.5:3456",
			headers:    map[string]string{"X-Real-IP": "203.0.113.9"},
			trustProxy: true,
			want:       "203.0.113.9",
		},
		{
			name:       "real ip strips port",
			remoteAddr: "172.18.0.5:3456",
			headers:    map[string]string{"X-Real-IP": "[2001:db8::1]:5555"},
			trustProxy: true,
			want:       "2001:db8::1",
		},
		{
			name:       "untrusted ignores headers",
			remoteAddr: "172.18.0.5:3456",
			headers: map[string]string{
				"X-Forwarded-For": "203.0.113.7",
				"X-Real-IP":       "203.0.113.9",
			},
			want: "172.18.0.5",
		},
		{
			name:       "trusted invalid headers fall back to remote addr",
			remoteAddr: "172.18.0.5:3456",
			headers: map[string]string{
				"X-Forwarded-For": "not-an-ip",
				"X-Real-IP":       "not-an-ip-either",
			},
			trustProxy: true,
			want:       "172.18.0.5",
		},
		{
			name:       "trusted no headers uses remote addr",
			remoteAddr: "172.18.0.5:3456",
			trustProxy: true,
			want:       "172.18.0.5",
		},
		{
			name:       "invalid remote addr",
			remoteAddr: "not-an-ip",
			trustProxy: true,
			want:       "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.RemoteAddr = tt.remoteAddr
			for key, value := range tt.headers {
				request.Header.Set(key, value)
			}
			if got := ClientIPFrom(request, tt.trustProxy); got != tt.want {
				t.Fatalf("ClientIPFrom() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestClientIPFromUsesLastForwardedHeaderLine(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = "172.18.0.5:3456"
	request.Header.Add("X-Forwarded-For", "192.0.2.1, 192.0.2.2")
	request.Header.Add("X-Forwarded-For", "203.0.113.7")
	request.Header.Add("X-Forwarded-For", " ")
	if got := ClientIPFrom(request, true); got != "203.0.113.7" {
		t.Fatalf("ClientIPFrom() = %q, want %q", got, "203.0.113.7")
	}
}

func TestClientIPIgnoresProxyHeaders(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = "172.18.0.5:3456"
	request.Header.Set("X-Forwarded-For", "203.0.113.7")
	request.Header.Set("X-Real-IP", "203.0.113.9")
	if got := ClientIP(request); got != "172.18.0.5" {
		t.Fatalf("ClientIP() = %q, want %q", got, "172.18.0.5")
	}
}

func TestTruncateEmailBoundsLength(t *testing.T) {
	short := "user@example.invalid"
	if got := TruncateEmail(short); got != short {
		t.Fatalf("TruncateEmail(short) = %q", got)
	}
	long := strings.Repeat("ж", MaxEmailLength+10)
	if got := TruncateEmail(long); utf8.RuneCountInString(got) != MaxEmailLength {
		t.Fatalf("TruncateEmail(long) has %d runes", utf8.RuneCountInString(got))
	}
}

func TestLoginRejectsOversizedEmailWithoutLookup(t *testing.T) {
	// A nil pool proves the address is rejected before any database lookup.
	service := &Service{}
	email := strings.Repeat("a", MaxEmailLength) + "@example.invalid"
	if _, _, err := service.Login(context.Background(), email, "irrelevant-password", "", ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("Login() error = %v, want ErrInvalidCredentials", err)
	}
}
