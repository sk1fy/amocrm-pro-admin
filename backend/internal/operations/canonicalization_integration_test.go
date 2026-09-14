package operations

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/catalog"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

type canonicalPayloadProbe struct {
	*fixture.Adapter
	calls   int
	payload json.RawMessage
}

func (p *canonicalPayloadProbe) ExecuteCommand(_ context.Context, _ adapter.Actor, key string, request adapter.CommandRequest) (adapter.CommandResult, error) {
	p.calls++
	p.payload = append(json.RawMessage(nil), request.Payload...)
	return adapter.CommandResult{ID: key, State: "succeeded", Outcome: "completed", Result: map[string]any{}, ObservedAt: time.Now().UTC()}, nil
}

func TestOperationNestedPayloadReplayPreservesIntegers(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	employeeStore := employees.NewStore(pool, 2*time.Second)
	employee, err := employeeStore.Create(t.Context(), employees.CreateInput{Email: "canonical@example.invalid", Name: "Fixture", Role: rbac.RoleAdmin, PasswordHash: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	backend := &canonicalPayloadProbe{Adapter: fixture.Demo("core")}
	svc := New(NewStore(pool, 2*time.Second, audit.NewStore(pool, 2*time.Second)), catalog.FromBackends(backend), employeeStore)
	input := Submit{EmployeeID: employee.ID, Backend: "core", Key: "fixture-nested-replay", Request: adapter.CommandRequest{
		TargetType: "installation", TargetID: testConnection, Command: "activity-panel-patch",
		Payload: json.RawMessage(`{"panel_id":"00000000-0000-4000-8000-000000000002","revision":9007199254740993,"display_window":{"to":"18:00","from":"09:00"}}`),
	}}
	first, err := svc.Execute(t.Context(), input)
	if err != nil || first.State != "succeeded" {
		t.Fatalf("first=%s, error=%v", first.State, err)
	}
	input.Request.Payload = json.RawMessage(`{"display_window":{"from":"09:00","to":"18:00"},"revision":9007199254740993,"panel_id":"00000000-0000-4000-8000-000000000002"}`)
	second, err := svc.Execute(t.Context(), input)
	if err != nil || first.ID != second.ID || backend.calls != 1 {
		t.Fatalf("replay error=%v, same ID=%v, dispatches=%d", err, first.ID == second.ID, backend.calls)
	}
	var dispatched struct {
		Revision int64 `json:"revision"`
	}
	if err := json.Unmarshal(backend.payload, &dispatched); err != nil || dispatched.Revision != 9007199254740993 {
		t.Fatalf("revision=%d, error=%v", dispatched.Revision, err)
	}
	input.Request.Payload = json.RawMessage(strings.ReplaceAll(string(input.Request.Payload), "9007199254740993", "9007199254740992"))
	if _, err := svc.Execute(t.Context(), input); !errors.Is(err, ErrConflict) {
		t.Fatalf("different integer must conflict: %v", err)
	}
	if backend.calls != 1 {
		t.Fatalf("unexpected redispatch: %d", backend.calls)
	}
}
