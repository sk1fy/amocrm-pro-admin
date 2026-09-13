package operations

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/catalog"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

type probe struct {
	*fixture.Adapter
	calls atomic.Int32
	hook  func()
	lost  bool
}

func (p *probe) ExecuteCommand(ctx context.Context, actor adapter.Actor, key string, r adapter.CommandRequest) (adapter.CommandResult, error) {
	p.calls.Add(1)
	if p.hook != nil {
		p.hook()
	}
	result, err := p.Adapter.ExecuteCommand(ctx, actor, key, r)
	if p.lost && err == nil {
		return adapter.CommandResult{}, adapter.ErrTimeout
	}
	return result, err
}

const testConnection = "f1a00000-0000-4000-8000-000000000001"

func TestOperationIdempotencyIsSharedAcrossEmployees(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	employeeStore := employees.NewStore(pool, 2*time.Second)
	first, err := employeeStore.Create(t.Context(), employees.CreateInput{Email: "first@example.invalid", Name: "First", Role: rbac.RoleAdmin, PasswordHash: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := employeeStore.Create(t.Context(), employees.CreateInput{Email: "second@example.invalid", Name: "Second", Role: rbac.RoleAdmin, PasswordHash: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	backend := &probe{Adapter: fixture.Demo("core")}
	svc := New(NewStore(pool, 2*time.Second, audit.NewStore(pool, 2*time.Second)), catalog.FromBackends(backend), employeeStore)
	request := Submit{EmployeeID: first.ID, Backend: "core", Key: "shared-key", Request: adapter.CommandRequest{TargetType: "installation", TargetID: testConnection, Command: "disable", Payload: json.RawMessage(`{}`)}}
	var wg sync.WaitGroup
	results := make([]Operation, 2)
	errs := make([]error, 2)
	for i, id := range []uuid.UUID{first.ID, second.ID} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			input := request
			input.EmployeeID = id
			results[i], errs[i] = svc.Execute(context.Background(), input)
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if results[0].ID != results[1].ID || backend.calls.Load() != 1 {
		t.Fatalf("duplicate effect: calls=%d ids=%v/%v", backend.calls.Load(), results[0].ID, results[1].ID)
	}
	request.Request.Payload = json.RawMessage(`{"different":true}`)
	if _, err = svc.Execute(t.Context(), request); !errors.Is(err, ErrConflict) {
		t.Fatalf("different payload: %v", err)
	}
	var count int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM admin_audit_log WHERE action IN ('operation.accepted','operation.succeeded')`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("audit count=%d err=%v", count, err)
	}
}

func TestLostResponseRecoversReceiptWithoutRedispatch(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	employeesStore := employees.NewStore(pool, 2*time.Second)
	employee, err := employeesStore.Create(t.Context(), employees.CreateInput{Email: "admin@example.invalid", Name: "Admin", Role: rbac.RoleAdmin, PasswordHash: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	backend := &probe{Adapter: fixture.Demo("core"), lost: true}
	store := NewStore(pool, 2*time.Second, audit.NewStore(pool, 2*time.Second))
	svc := New(store, catalog.FromBackends(backend), employeesStore)
	input := Submit{EmployeeID: employee.ID, Backend: "core", Key: "secret-rotation", Request: adapter.CommandRequest{TargetType: "integration", TargetID: "f1000000-0000-4000-8000-000000000001", Command: "create", Payload: json.RawMessage(`{"code":"new-fixture","client_id":"11111111-1111-4111-8111-111111111111","client_secret":"not-persisted-value","redirect_uri":"https://app.example.invalid/callback","services":[]}`)}}
	input.Request.TargetID = "new"
	result, err := svc.Execute(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "unknown_outcome" {
		t.Fatalf("state=%s", result.State)
	}
	result, err = svc.Get(t.Context(), result.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "succeeded" || backend.calls.Load() != 1 {
		t.Fatalf("recovery=%s calls=%d", result.State, backend.calls.Load())
	}
	var rows string
	if err = pool.QueryRow(t.Context(), `SELECT row_to_json(operations)::text FROM operations WHERE id=$1`, result.ID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(rows, "not-persisted-value") {
		t.Fatal("secret was persisted")
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "request_hash") || strings.Contains(string(encoded), "idempotency_key") {
		t.Fatal("internal fields leaked")
	}
}

func TestConcurrentTargetAndRoleDenial(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	employeeStore := employees.NewStore(pool, 2*time.Second)
	employee, err := employeeStore.Create(t.Context(), employees.CreateInput{Email: "operator@example.invalid", Name: "Operator", Role: rbac.RoleOperator, PasswordHash: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	started, release := make(chan struct{}), make(chan struct{})
	backend := &probe{Adapter: fixture.Demo("core"), hook: func() { close(started); <-release }}
	svc := New(NewStore(pool, 2*time.Second, audit.NewStore(pool, 2*time.Second)), catalog.FromBackends(backend), employeeStore)
	input := Submit{EmployeeID: employee.ID, Backend: "core", Key: "first", Request: adapter.CommandRequest{TargetType: "installation", TargetID: testConnection, Command: "disable", Payload: json.RawMessage(`{}`)}}
	done := make(chan error, 1)
	go func() { _, err := svc.Execute(context.Background(), input); done <- err }()
	<-started
	other := input
	other.Key = "second"
	_, err = svc.Execute(t.Context(), other)
	if !errors.Is(err, ErrConflict) {
		t.Errorf("concurrent target err=%v", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	other.Request.Command = "uninstall"
	if _, err := svc.Execute(t.Context(), other); !errors.Is(err, ErrForbidden) {
		t.Fatalf("operator uninstall=%v", err)
	}
	role := rbac.RoleViewer
	if _, _, _, err := employeeStore.Update(t.Context(), employee.ID, employees.UpdateInput{Role: &role}); err != nil {
		t.Fatal(err)
	}
	other.Request.Command = "enable"
	if _, err := svc.Execute(t.Context(), other); !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer command=%v", err)
	}
}

func TestExpiredDispatchLeaseBecomesUnknownWithoutReplay(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	employeesStore := employees.NewStore(pool, 2*time.Second)
	employee, err := employeesStore.Create(t.Context(), employees.CreateInput{Email: "crash@example.invalid", Name: "Crash", Role: rbac.RoleAdmin, PasswordHash: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	backend := &probe{Adapter: fixture.Demo("core")}
	store := NewStore(pool, 2*time.Second, audit.NewStore(pool, 2*time.Second))
	svc := New(store, catalog.FromBackends(backend), employeesStore)
	admitted, _, err := store.Admit(t.Context(), Operation{ID: uuid.New(), EmployeeID: employee.ID, ActorEmail: employee.Email, Backend: "core", TargetType: "installation", TargetID: testConnection, Command: "disable", Key: "crashed", Hash: make([]byte, 32), LeaseUntil: time.Now().Add(-time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(t.Context(), admitted.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != "unknown_outcome" || backend.calls.Load() != 0 {
		t.Fatalf("state=%s calls=%d", got.State, backend.calls.Load())
	}
}

type roleChangeProbe struct {
	*probe
	employees  *employees.Store
	employeeID uuid.UUID
}

func (p *roleChangeProbe) GetConnection(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[adapter.ConnectionDetail], error) {
	role := rbac.RoleViewer
	if _, _, _, err := p.employees.Update(ctx, p.employeeID, employees.UpdateInput{Role: &role}); err != nil {
		return adapter.Observation[adapter.ConnectionDetail]{}, err
	}
	return p.Adapter.GetConnection(ctx, actor, id)
}
func TestRoleIsRecheckedAfterPreflight(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	employeeStore := employees.NewStore(pool, 2*time.Second)
	employee, err := employeeStore.Create(t.Context(), employees.CreateInput{Email: "role-change@example.invalid", Name: "Operator", Role: rbac.RoleOperator, PasswordHash: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	backend := &roleChangeProbe{probe: &probe{Adapter: fixture.Demo("core")}, employees: employeeStore, employeeID: employee.ID}
	svc := New(NewStore(pool, 2*time.Second, audit.NewStore(pool, 2*time.Second)), catalog.FromBackends(backend), employeeStore)
	op, err := svc.Execute(t.Context(), Submit{EmployeeID: employee.ID, Backend: "core", Key: "role-change", Request: adapter.CommandRequest{TargetType: "installation", TargetID: testConnection, Command: "disable", Payload: json.RawMessage(`{}`)}})
	if err != nil {
		t.Fatal(err)
	}
	if op.State != "failed" || op.Error == nil || op.Error.Code != "forbidden" || backend.calls.Load() != 0 {
		t.Fatalf("stale permission dispatch: %+v calls=%d", op, backend.calls.Load())
	}
}
