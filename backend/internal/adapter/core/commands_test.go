package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

func TestCommandsRejectRedirectsAndDistinguishAuthRejection(t *testing.T) {
	var leaked atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked.Add(1); w.WriteHeader(200) }))
	defer destination.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Idempotency-Key") == "denied" {
			w.WriteHeader(401)
			return
		}
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	client := testClient(t, server.URL)
	request := adapter.CommandRequest{TargetType: "integration", TargetID: "new", Command: "create", Payload: json.RawMessage(`{"client_secret":"fixture-private-value"}`)}
	_, err := client.ExecuteCommand(context.Background(), adapter.Actor{Value: "employee:test"}, "redirect", request)
	if err == nil || leaked.Load() != 0 {
		t.Fatalf("mutation redirect followed: err=%v count=%d", err, leaked.Load())
	}
	_, err = client.ExecuteCommand(context.Background(), adapter.Actor{Value: "employee:test"}, "denied", request)
	if !errors.Is(err, adapter.ErrRejected) {
		t.Fatalf("definitive rejection=%v", err)
	}
}
