package httpapi

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

type trackedRequestBody struct {
	io.Reader
	closed bool
}

func (b *trackedRequestBody) Close() error {
	b.closed = true
	return nil
}

func TestDecodeJSONEnforcesWholeObjectAndClosesBody(t *testing.T) {
	for _, tc := range []struct {
		body  string
		valid bool
	}{
		{`{}`, true},
		{" \n{}\t", true},
		{`{} {}`, false},
		{`{} null`, false},
		{`{} garbage`, false},
		{`null`, false},
		{`{}` + strings.Repeat(" ", maxBodyBytes), false},
	} {
		r := httptest.NewRequest("POST", "/api/v1/auth/login", nil)
		tracked := &trackedRequestBody{Reader: strings.NewReader(tc.body)}
		r.Body = tracked
		var dest struct{}
		if err := decodeJSON(r, &dest); (err == nil) != tc.valid {
			t.Errorf("valid=%v, error=%v", tc.valid, err)
		}
		if !tracked.closed {
			t.Error("request body not closed")
		}
	}
}
