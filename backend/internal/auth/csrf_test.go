package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

func TestCSRFRejectsMutationsWithoutHeaders(t *testing.T) {
	router := chi.NewRouter()
	router.Use(httpx.RequestID)
	router.Use(CSRF("http://127.0.0.1:5173"))
	router.Post("/login", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	router.Get("/ok", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	get := httptest.NewRecorder()
	router.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/ok", nil))
	if get.Code != http.StatusNoContent {
		t.Fatalf("GET status = %d", get.Code)
	}

	missing := httptest.NewRecorder()
	router.ServeHTTP(missing, httptest.NewRequest(http.MethodPost, "/login", nil))
	if missing.Code != http.StatusForbidden {
		t.Fatalf("missing headers status = %d %s", missing.Code, missing.Body.String())
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(missing.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != httpx.CodeForbidden {
		t.Fatalf("code = %s", body.Error.Code)
	}

	badOrigin := httptest.NewRequest(http.MethodPost, "/login", nil)
	badOrigin.Header.Set("X-Requested-With", RequestedWith)
	badOrigin.Header.Set("Origin", "http://evil.example.invalid")
	bad := httptest.NewRecorder()
	router.ServeHTTP(bad, badOrigin)
	if bad.Code != http.StatusForbidden {
		t.Fatalf("bad origin status = %d", bad.Code)
	}

	okReq := httptest.NewRequest(http.MethodPost, "/login", nil)
	okReq.Header.Set("X-Requested-With", RequestedWith)
	okReq.Header.Set("Origin", "http://127.0.0.1:5173/")
	ok := httptest.NewRecorder()
	router.ServeHTTP(ok, okReq)
	if ok.Code != http.StatusNoContent {
		t.Fatalf("valid csrf status = %d", ok.Code)
	}
}
