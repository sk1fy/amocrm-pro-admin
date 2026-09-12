package httpx

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func TestRequestIDHonorsIncomingUUID(t *testing.T) {
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	router := chi.NewRouter()
	router.Use(RequestID)
	router.Get("/", func(w http.ResponseWriter, r *http.Request) {
		if RequestIDFromContext(r.Context()) != id {
			t.Errorf("context id = %s", RequestIDFromContext(r.Context()))
		}
		w.WriteHeader(http.StatusNoContent)
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Request-ID", id.String())
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Header().Get("X-Request-ID") != id.String() {
		t.Fatalf("response request id = %q", rec.Header().Get("X-Request-ID"))
	}
}

func TestRecoverWritesJSONWithoutStack(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := chi.NewRouter()
	router.Use(RequestID)
	router.Use(Recover(logger))
	router.Get("/", func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
	var body jsonError
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != CodeInternal || body.Error.Message != "internal error" {
		t.Fatalf("body = %+v", body)
	}
	if strings.Contains(rec.Body.String(), "boom") || strings.Contains(rec.Body.String(), "goroutine") {
		t.Fatalf("stack leaked: %s", rec.Body.String())
	}
}
