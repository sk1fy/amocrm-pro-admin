package operations

import (
	"context"
	"encoding/json"
	"errors"
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

// An unknown_outcome without a Core receipt must not be rewritten by later
// polls: otherwise finished_at/updated_at move forward and retention never
// prunes it.
func TestUnknownOutcomeIsNotRewrittenByPolls(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	es := employees.NewStore(pool, 2*time.Second)
	emp, err := es.Create(t.Context(), employees.CreateInput{Email: "poll@example.invalid", Name: "Poll", Role: rbac.RoleAdmin, PasswordHash: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(pool, 2*time.Second, audit.NewStore(pool, 2*time.Second))
	svc := New(store, catalog.FromBackends(&probe{Adapter: fixture.Demo("core")}), es)
	op, _, err := store.Admit(t.Context(), Operation{ID: uuid.New(), EmployeeID: emp.ID, ActorEmail: emp.Email, Backend: "core", TargetType: "installation", TargetID: testConnection, Command: "disable", Key: "lost", Hash: make([]byte, 32), LeaseUntil: time.Now().Add(-time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	if first, err := svc.Get(t.Context(), op.ID); err != nil || first.State != "unknown_outcome" {
		t.Fatalf("first poll: %v %s", err, first.State)
	}
	old := time.Now().Add(-200 * 24 * time.Hour).UTC()
	// Age the row past a 180-day retention cutoff; the trigger would reset updated_at.
	if _, err := pool.Exec(t.Context(), `ALTER TABLE operations DISABLE TRIGGER operations_updated_at`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE operations SET updated_at=$2, finished_at=$2 WHERE id=$1`, op.ID, old); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `ALTER TABLE operations ENABLE TRIGGER operations_updated_at`); err != nil {
		t.Fatal(err)
	}
	cutoff := time.Now().Add(-180 * 24 * time.Hour)
	for range 3 {
		if _, err := svc.Get(t.Context(), op.ID); err != nil {
			t.Fatal(err)
		}
	}
	got, err := store.Get(t.Context(), op.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != "unknown_outcome" || got.FinishedAt == nil || !got.FinishedAt.Equal(old.Truncate(time.Microsecond)) {
		t.Fatalf("state=%s finished_at=%v, want %v", got.State, got.FinishedAt, old)
	}
	if count, err := store.CountTerminalBefore(t.Context(), cutoff); err != nil || count != 1 {
		t.Fatalf("prunable=%d err=%v, want 1", count, err)
	}
	var audits int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM admin_audit_log WHERE action='operation.unknown_outcome'`).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("audits=%d err=%v, want 1", audits, err)
	}
}

type forbiddenCore struct{ *probe }

func (f *forbiddenCore) ExecuteCommand(context.Context, adapter.Actor, string, adapter.CommandRequest) (adapter.CommandResult, error) {
	f.calls.Add(1)
	// core.Client maps HTTP 403 from POST /admin/v1/commands to Forbidden; Core
	// keeps no receipt, so the command definitely did not run.
	return adapter.CommandResult{}, adapter.Forbidden("core", "command is not permitted")
}

func TestCoreForbiddenIsFailed(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	es := employees.NewStore(pool, 2*time.Second)
	emp, err := es.Create(t.Context(), employees.CreateInput{Email: "core403@example.invalid", Name: "Core403", Role: rbac.RoleAdmin, PasswordHash: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	backend := &forbiddenCore{probe: &probe{Adapter: fixture.Demo("core")}}
	svc := New(NewStore(pool, 2*time.Second, audit.NewStore(pool, 2*time.Second)), catalog.FromBackends(backend), es)
	got, err := svc.Execute(t.Context(), Submit{EmployeeID: emp.ID, Backend: "core", Key: "k403", Request: adapter.CommandRequest{TargetType: "installation", TargetID: testConnection, Command: "disable", Payload: json.RawMessage(`{}`)}})
	if err != nil {
		t.Fatal(err)
	}
	if got.State != "failed" || got.Error == nil || got.Error.Code != adapter.ErrorCodePermissionDenied || got.Error.Message != "command is not permitted" {
		t.Fatalf("state=%s error=%+v", got.State, got.Error)
	}
}

type flakyEmployees struct {
	inner  *employees.Store
	calls  atomic.Int32
	failOn int32
}

func (f *flakyEmployees) Get(ctx context.Context, id uuid.UUID) (rbac.Employee, error) {
	if f.calls.Add(1) == f.failOn {
		return rbac.Employee{}, errors.New("simulated admin DB timeout")
	}
	return f.inner.Get(ctx, id)
}

// A transient admin DB error during the pre-dispatch role check is not a
// permission decision: the operation fails as unavailable, not forbidden.
func TestAdminDBErrorBeforeDispatchIsNotForbidden(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	es := employees.NewStore(pool, 2*time.Second)
	emp, err := es.Create(t.Context(), employees.CreateInput{Email: "flaky@example.invalid", Name: "Flaky", Role: rbac.RoleAdmin, PasswordHash: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	backend := &probe{Adapter: fixture.Demo("core")}
	svc := New(NewStore(pool, 2*time.Second, audit.NewStore(pool, 2*time.Second)), catalog.FromBackends(backend), &flakyEmployees{inner: es, failOn: 2})
	got, err := svc.Execute(t.Context(), Submit{EmployeeID: emp.ID, Backend: "core", Key: "kdb", Request: adapter.CommandRequest{TargetType: "installation", TargetID: testConnection, Command: "disable", Payload: json.RawMessage(`{}`)}})
	if err != nil {
		t.Fatal(err)
	}
	if got.State != "failed" || got.Error == nil || got.Error.Code != "backend_unavailable" || backend.calls.Load() != 0 {
		t.Fatalf("state=%s error=%+v calls=%d", got.State, got.Error, backend.calls.Load())
	}

	// Before admission the same failure is returned to the caller, not ErrForbidden.
	_, err = New(NewStore(pool, 2*time.Second, audit.NewStore(pool, 2*time.Second)), catalog.FromBackends(backend), &flakyEmployees{inner: es, failOn: 1}).
		Execute(t.Context(), Submit{EmployeeID: emp.ID, Backend: "core", Key: "kdb-early", Request: adapter.CommandRequest{TargetType: "installation", TargetID: testConnection, Command: "disable", Payload: json.RawMessage(`{}`)}})
	if errors.Is(err, ErrForbidden) || !errors.Is(err, adapter.ErrUnavailable) {
		t.Fatalf("err=%v, want unavailable", err)
	}
}
