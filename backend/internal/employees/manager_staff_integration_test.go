package employees_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

type staffFixture struct {
	pool          *pgxpool.Pool
	store         *employees.Store
	access        *employees.Access
	core, manager *auth.Service
	actor         employees.Employee
	p             auth.Principal
	token         string
}

func newStaffFixture(t *testing.T) staffFixture {
	t.Helper()
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := context.Background()
	f := staffFixture{pool: pool, store: employees.NewStore(pool, 5*time.Second), core: auth.NewService(pool, 5*time.Second, 12*time.Hour, 2*time.Hour, false), manager: auth.NewManagerService(pool, 5*time.Second, 12*time.Hour, 2*time.Hour, false)}
	f.access = employees.NewAccess(f.store, f.manager, audit.NewStore(pool, 5*time.Second))
	hash, err := auth.Hash("fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	f.actor, err = f.store.Create(ctx, employees.CreateInput{Email: "actor@example.invalid", Name: "Actor", Role: rbac.RoleAdmin, PasswordHash: hash})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.access.BootstrapManager(ctx, f.actor.Email, audit.Event{}); err != nil {
		t.Fatal(err)
	}
	f.token, _, err = f.manager.Login(ctx, f.actor.Email, "fixture-password", "127.0.0.1", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	f.p, err = f.manager.Lookup(ctx, f.token)
	if err != nil {
		t.Fatal(err)
	}
	return f
}
func (f staffFixture) invite(t *testing.T, email string, grants []auth.ManagerGrant) (employees.StaffCommand, employees.StaffResult, string) {
	t.Helper()
	c := employees.StaffCommand{SessionID: f.p.SessionID, CommandID: uuid.New(), Kind: "invite", Email: email, Name: "Fixture", Grants: grants}
	r, token, err := f.access.ManagerStaffCommand(context.Background(), c)
	if err != nil {
		t.Fatal(err)
	}
	return c, r, token
}
func TestManagerStaffInvitationLifecycleAndCoreIsolation(t *testing.T) {
	f := newStaffFixture(t)
	ctx := context.Background()
	c, first, old := f.invite(t, "invited@example.invalid", []auth.ManagerGrant{auth.GrantClientsRead})
	if first.Staff.Status != "invited" || first.LinkUnavailable || old == "" {
		t.Fatalf("unexpected first result %+v", first)
	}
	replay, token, err := f.access.ManagerStaffCommand(ctx, c)
	if err != nil || !replay.LinkUnavailable || token != "" || replay.Staff.ID != first.Staff.ID {
		t.Fatalf("unsafe replay %+v %v", replay, err)
	}
	c.Name = "Other"
	if _, _, err := f.access.ManagerStaffCommand(ctx, c); !errors.Is(err, employees.ErrStaffIdempotency) {
		t.Fatalf("changed replay %v", err)
	}
	reissue := employees.StaffCommand{SessionID: f.p.SessionID, CommandID: uuid.New(), TargetID: first.Staff.ID, Kind: "reissue", Version: first.Staff.Version}
	reissued, newToken, err := f.access.ManagerStaffCommand(ctx, reissue)
	if err != nil || newToken == old || newToken == "" {
		t.Fatalf("reissue %v", err)
	}
	if err := f.access.AcceptManagerInvitation(ctx, old, "new-fixture-password", uuid.New(), audit.Event{}); !errors.Is(err, employees.ErrInvitation) {
		t.Fatalf("old token %v", err)
	}
	acceptKey := uuid.New()
	if err := f.access.AcceptManagerInvitation(ctx, newToken, "new-fixture-password", acceptKey, audit.Event{}); err != nil {
		t.Fatal(err)
	}
	if err := f.access.AcceptManagerInvitation(ctx, newToken, "new-fixture-password", acceptKey, audit.Event{}); err != nil {
		t.Fatalf("lost response retry %v", err)
	}
	if err := f.access.AcceptManagerInvitation(ctx, newToken, "wrong-password", acceptKey, audit.Event{}); !errors.Is(err, employees.ErrInvitation) {
		t.Fatalf("changed retry %v", err)
	}
	if err := f.access.AcceptManagerInvitation(ctx, newToken, "new-fixture-password", uuid.New(), audit.Event{}); !errors.Is(err, employees.ErrInvitation) {
		t.Fatalf("second accept %v", err)
	}
	if _, _, err := f.core.Login(ctx, first.Staff.Email, "new-fixture-password", "127.0.0.1", ""); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("Core login allowed %v", err)
	}
	if _, err := f.store.Get(ctx, first.Staff.ID); !errors.Is(err, employees.ErrNotFound) {
		t.Fatalf("fresh RBAC allowed %v", err)
	}
	managerToken, _, err := f.manager.Login(ctx, first.Staff.Email, "new-fixture-password", "127.0.0.1", "")
	if err != nil {
		t.Fatal(err)
	}
	fake, hash, err := auth.NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO sessions(employee_id,token_hash,expires_at)VALUES($1,$2,now()+interval '1 hour')`, first.Staff.ID, hash); err != nil {
		t.Fatal(err)
	}
	if _, err := f.core.Lookup(ctx, fake); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("Core lookup allowed %v", err)
	}
	if _, _, err := f.access.ManagerStaffCommand(ctx, reissue); err != nil {
		t.Fatalf("safe replay after accept %v", err)
	}
	reissue.CommandID = uuid.New()
	reissue.Version = reissued.Staff.Version + 1
	if _, _, err := f.access.ManagerStaffCommand(ctx, reissue); !errors.Is(err, employees.ErrInvitation) {
		t.Fatalf("reset accepted identity %v", err)
	}
	current, err := f.access.ManagerStaffGet(ctx, f.p.SessionID, first.Staff.ID)
	if err != nil {
		t.Fatal(err)
	}
	patch := employees.StaffCommand{SessionID: f.p.SessionID, CommandID: uuid.New(), TargetID: first.Staff.ID, Kind: "grants", Version: current.Version, Grants: []auth.ManagerGrant{}}
	if _, _, err := f.access.ManagerStaffCommand(ctx, patch); err != nil {
		t.Fatal(err)
	}
	if _, err := f.manager.Lookup(ctx, managerToken); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("manager revoke not applied %v", err)
	}
	var receipt string
	if err := f.pool.QueryRow(ctx, `SELECT result::text FROM manager_staff_receipts WHERE command_id=$1`, c.CommandID).Scan(&receipt); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(receipt, old) || strings.Contains(receipt, newToken) || strings.Contains(receipt, "invitation_url") {
		t.Fatal("receipt contains link")
	}
	var count int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM admin_audit_log WHERE action='manager.invitation.accept'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("accept audit count %d %v", count, err)
	}
}
func TestManagerStaffRevokePreservesCoreAndTechnicalRoleChangePreservesManager(t *testing.T) {
	f := newStaffFixture(t)
	ctx := context.Background()
	hash, _ := auth.Hash("fixture-password")
	target, err := f.store.Create(ctx, employees.CreateInput{Email: "technical@example.invalid", Name: "Technical", Role: rbac.RoleAdmin, PasswordHash: hash})
	if err != nil {
		t.Fatal(err)
	}
	staff, err := f.access.ManagerStaffGet(ctx, f.p.SessionID, target.ID)
	if err != nil {
		t.Fatal(err)
	}
	cmd := employees.StaffCommand{SessionID: f.p.SessionID, CommandID: uuid.New(), TargetID: target.ID, Kind: "grants", Version: staff.Version, Grants: []auth.ManagerGrant{auth.GrantClientsRead}}
	_, _, err = f.access.ManagerStaffCommand(ctx, cmd)
	if err != nil {
		t.Fatal(err)
	}
	ct, _, err := f.core.Login(ctx, target.Email, "fixture-password", "127.0.0.1", "")
	if err != nil {
		t.Fatal(err)
	}
	mt, _, err := f.manager.Login(ctx, target.Email, "fixture-password", "127.0.0.1", "")
	if err != nil {
		t.Fatal(err)
	}
	cmd.Kind = "revoke_sessions"
	cmd.CommandID = uuid.New()
	cmd.Version = 0
	cmd.Grants = nil
	if _, _, err := f.access.ManagerStaffCommand(ctx, cmd); err != nil {
		t.Fatal(err)
	}
	if _, err := f.manager.Lookup(ctx, mt); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("manager session preserved %v", err)
	}
	if _, err := f.core.Lookup(ctx, ct); err != nil {
		t.Fatalf("Core session revoked %v", err)
	}
	mt, _, err = f.manager.Login(ctx, target.Email, "fixture-password", "127.0.0.1", "")
	if err != nil {
		t.Fatal(err)
	}
	role := rbac.RoleViewer
	if _, err := employees.NewAccess(f.store, f.core, audit.NewStore(f.pool, 5*time.Second)).Update(ctx, target.ID, employees.UpdateInput{Role: &role}, audit.Event{}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.manager.Lookup(ctx, mt); err != nil {
		t.Fatalf("role change revoked manager %v", err)
	}
	if _, err := f.core.Lookup(ctx, ct); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("role change preserved Core %v", err)
	}
}
func TestManagerStaffAuditAndReceiptFailuresRollback(t *testing.T) {
	for _, table := range []string{"admin_audit_log", "manager_staff_receipts"} {
		t.Run(table, func(t *testing.T) {
			f := newStaffFixture(t)
			ctx := context.Background()
			_, err := f.pool.Exec(ctx, `CREATE FUNCTION reject_staff_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$`)
			if err != nil {
				t.Fatal(err)
			}
			_, err = f.pool.Exec(ctx, `CREATE TRIGGER reject_staff_fixture BEFORE INSERT ON `+table+` FOR EACH ROW EXECUTE FUNCTION reject_staff_fixture()`)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				_, _ = f.pool.Exec(ctx, `DROP TRIGGER reject_staff_fixture ON `+table+`; DROP FUNCTION reject_staff_fixture()`)
			})
			c := employees.StaffCommand{SessionID: f.p.SessionID, CommandID: uuid.New(), Kind: "invite", Email: "rollback@example.invalid", Name: "Rollback", Grants: []auth.ManagerGrant{auth.GrantClientsRead}}
			if _, _, err := f.access.ManagerStaffCommand(ctx, c); err == nil {
				t.Fatal("failure accepted")
			}
			if _, err := f.store.GetByEmail(ctx, c.Email); !errors.Is(err, employees.ErrNotFound) {
				t.Fatalf("identity survived rollback %v", err)
			}
		})
	}
}
func TestManagerStaffLastAdminAndQueuedActor(t *testing.T) {
	f := newStaffFixture(t)
	ctx := context.Background()
	hash, _ := auth.Hash("fixture-password")
	target, err := f.store.Create(ctx, employees.CreateInput{Email: "second@example.invalid", Name: "Second", Role: rbac.RoleViewer, PasswordHash: hash})
	if err != nil {
		t.Fatal(err)
	}
	staff, err := f.access.ManagerStaffGet(ctx, f.p.SessionID, target.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = f.access.ManagerStaffCommand(ctx, employees.StaffCommand{SessionID: f.p.SessionID, CommandID: uuid.New(), Kind: "grants", TargetID: target.ID, Version: staff.Version, Grants: auth.ManagerAdminGrants()})
	if err != nil {
		t.Fatal(err)
	}
	targetToken, _, err := f.manager.Login(ctx, target.Email, "fixture-password", "127.0.0.1", "")
	if err != nil {
		t.Fatal(err)
	}
	p2, err := f.manager.Lookup(ctx, targetToken)
	if err != nil {
		t.Fatal(err)
	}
	a, err := f.access.ManagerStaffGet(ctx, f.p.SessionID, f.actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	b, err := f.access.ManagerStaffGet(ctx, f.p.SessionID, target.ID)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	start := make(chan struct{})
	for _, c := range []employees.StaffCommand{{SessionID: f.p.SessionID, CommandID: uuid.New(), Kind: "grants", TargetID: target.ID, Version: b.Version, Grants: []auth.ManagerGrant{}}, {SessionID: p2.SessionID, CommandID: uuid.New(), Kind: "grants", TargetID: f.actor.ID, Version: a.Version, Grants: []auth.ManagerGrant{}}} {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; _, _, err := f.access.ManagerStaffCommand(ctx, c); errs <- err }()
	}
	close(start)
	wg.Wait()
	close(errs)
	successes := 0
	for err := range errs {
		if err == nil {
			successes++
		} else if !errors.Is(err, auth.ErrUnauthenticated) && !errors.Is(err, employees.ErrStaffForbidden) && !errors.Is(err, employees.ErrLastManagerAdmin) {
			t.Fatal(err)
		}
	}
	if successes != 1 {
		t.Fatalf("successful revocations %d", successes)
	}
	var count int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM manager_grants g JOIN employees e ON e.id=g.employee_id WHERE g.grant_code='staff.manage' AND e.status='active' AND e.password_hash IS NOT NULL`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("administrators %d %v", count, err)
	}
}
func TestManagerStaffScopedCursorAndAuditProjection(t *testing.T) {
	f := newStaffFixture(t)
	ctx := context.Background()
	f.invite(t, "a@example.invalid", []auth.ManagerGrant{auth.GrantClientsRead})
	f.invite(t, "b@example.invalid", []auth.ManagerGrant{auth.GrantClientsRead})
	page, err := f.access.ManagerStaffList(ctx, f.p.SessionID, "", "", 1)
	if err != nil || page.NextCursor == nil {
		t.Fatalf("page %v", err)
	}
	next, err := f.access.ManagerStaffList(ctx, f.p.SessionID, "", *page.NextCursor, 1)
	if err != nil || len(next.Items) != 1 || next.Items[0].ID == page.Items[0].ID {
		t.Fatalf("next %v", err)
	}
	if _, err := f.access.ManagerStaffList(ctx, f.p.SessionID, "b", *page.NextCursor, 1); !errors.Is(err, employees.ErrStaffInvalid) {
		t.Fatalf("cursor filter accepted %v", err)
	}
	if _, err := f.access.ManagerStaffList(ctx, f.p.SessionID, "", *page.NextCursor+"a", 1); !errors.Is(err, employees.ErrStaffInvalid) {
		t.Fatalf("cursor tamper accepted %v", err)
	}
	token, _, err := f.manager.Login(ctx, f.actor.Email, "fixture-password", "127.0.0.1", "")
	if err != nil {
		t.Fatal(err)
	}
	p, err := f.manager.Lookup(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.access.ManagerStaffList(ctx, p.SessionID, "", *page.NextCursor, 1); !errors.Is(err, employees.ErrStaffInvalid) {
		t.Fatalf("cross session cursor accepted %v", err)
	}
	audits, err := f.access.ManagerSecurityAudit(ctx, f.p.SessionID, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(audits)
	for _, forbidden := range []string{"metadata", "token", "password", "ip", "actor_email"} {
		if strings.Contains(string(raw), `"`+forbidden+`"`) {
			t.Fatalf("unsafe audit %s", forbidden)
		}
	}
}

func TestManagerStaffQueuedReplayRechecksActor(t *testing.T) {
	f := newStaffFixture(t)
	ctx := context.Background()
	command, _, _ := f.invite(t, "queued@example.invalid", []auth.ManagerGrant{auth.GrantClientsRead})
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `LOCK TABLE manager_grants IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, _, err := f.access.ManagerStaffCommand(ctx, command); done <- err }()
	deadline := time.Now().Add(3 * time.Second)
	for {
		var waiting bool
		if err := f.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'LOCK TABLE manager_grants%')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("command never queued behind manager lock")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM manager_grants WHERE employee_id=$1`, f.actor.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("queued replay authorized stale actor %v", err)
	}
}

func TestManagerStaffConcurrentAcceptanceConsumesOnce(t *testing.T) {
	f := newStaffFixture(t)
	ctx := context.Background()
	_, _, token := f.invite(t, "race@example.invalid", []auth.ManagerGrant{auth.GrantClientsRead})
	start := make(chan struct{})
	done := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			done <- f.access.AcceptManagerInvitation(ctx, token, "new-fixture-password", uuid.New(), audit.Event{})
		}()
	}
	close(start)
	successes := 0
	for range 2 {
		err := <-done
		if err == nil {
			successes++
		} else if !errors.Is(err, employees.ErrInvitation) {
			t.Fatal(err)
		}
	}
	if successes != 1 {
		t.Fatalf("acceptance count %d", successes)
	}
}

func TestManagerStaffGrantsRollbackPreservesVersionAndSession(t *testing.T) {
	f := newStaffFixture(t)
	ctx := context.Background()
	hash, _ := auth.Hash("fixture-password")
	target, err := f.store.Create(ctx, employees.CreateInput{Email: "rollback-target@example.invalid", Name: "Target", Role: rbac.RoleViewer, PasswordHash: hash})
	if err != nil {
		t.Fatal(err)
	}
	current, err := f.access.ManagerStaffGet(ctx, f.p.SessionID, target.ID)
	if err != nil {
		t.Fatal(err)
	}
	c := employees.StaffCommand{SessionID: f.p.SessionID, CommandID: uuid.New(), Kind: "grants", TargetID: target.ID, Version: current.Version, Grants: []auth.ManagerGrant{auth.GrantClientsRead}}
	result, _, err := f.access.ManagerStaffCommand(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := f.manager.Login(ctx, target.Email, "fixture-password", "127.0.0.1", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `CREATE FUNCTION reject_staff_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER reject_staff_fixture BEFORE INSERT ON manager_staff_receipts FOR EACH ROW EXECUTE FUNCTION reject_staff_fixture()`); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = f.pool.Exec(ctx, `DROP TRIGGER reject_staff_fixture ON manager_staff_receipts; DROP FUNCTION reject_staff_fixture()`)
	}()
	c.CommandID = uuid.New()
	c.Version = result.Staff.Version
	c.Grants = []auth.ManagerGrant{}
	if _, _, err := f.access.ManagerStaffCommand(ctx, c); err == nil {
		t.Fatal("receipt failure accepted")
	}
	current, err = f.access.ManagerStaffGet(ctx, f.p.SessionID, target.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Version != result.Staff.Version || len(current.Grants) != 1 {
		t.Fatal("grants or version survived failed command")
	}
	if _, err := f.manager.Lookup(ctx, token); err != nil {
		t.Fatalf("session revoked despite rollback %v", err)
	}
}

func TestManagerStaffAcceptReissueRace(t *testing.T) {
	f := newStaffFixture(t)
	ctx := context.Background()
	_, initial, oldToken := f.invite(t, "reissue-race@example.invalid", []auth.ManagerGrant{auth.GrantClientsRead})
	type outcome struct {
		kind  string
		err   error
		token string
	}
	done := make(chan outcome, 2)
	start := make(chan struct{})
	go func() {
		<-start
		done <- outcome{kind: "accept", err: f.access.AcceptManagerInvitation(ctx, oldToken, "fixture-password", uuid.New(), audit.Event{})}
	}()
	go func() {
		<-start
		_, token, err := f.access.ManagerStaffCommand(ctx, employees.StaffCommand{SessionID: f.p.SessionID, CommandID: uuid.New(), Kind: "reissue", TargetID: initial.Staff.ID, Version: initial.Staff.Version})
		done <- outcome{kind: "reissue", token: token, err: err}
	}()
	close(start)
	successes := 0
	for range 2 {
		r := <-done
		if r.err == nil {
			successes++
			if r.kind == "reissue" {
				if err := f.access.AcceptManagerInvitation(ctx, r.token, "fixture-password", uuid.New(), audit.Event{}); err != nil {
					t.Fatal(err)
				}
			}
		} else if !errors.Is(r.err, employees.ErrInvitation) && !errors.Is(r.err, employees.ErrStaffVersion) {
			t.Fatal(r.err)
		}
	}
	if successes != 1 {
		t.Fatalf("race accepted %d initial operations", successes)
	}
}

func TestManagerStaffSelfEscalationAndPrivilegeAndExistingIdentity(t *testing.T) {
	f := newStaffFixture(t)
	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `DELETE FROM manager_grants WHERE employee_id=$1 AND grant_code='identity.manage'`, f.actor.ID); err != nil {
		t.Fatal(err)
	}
	actor, err := f.access.ManagerStaffGet(ctx, f.p.SessionID, f.actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	c := employees.StaffCommand{SessionID: f.p.SessionID, CommandID: uuid.New(), Kind: "grants", TargetID: f.actor.ID, Version: actor.Version, Grants: auth.ManagerAdminGrants()}
	if _, _, err := f.access.ManagerStaffCommand(ctx, c); !errors.Is(err, employees.ErrSelfEscalation) {
		t.Fatalf("self escalation %v", err)
	}
	c = employees.StaffCommand{SessionID: f.p.SessionID, CommandID: uuid.New(), Kind: "invite", Email: "blocked@example.invalid", Name: "Blocked", Grants: []auth.ManagerGrant{auth.GrantClientsRead}}
	if _, _, err := f.access.ManagerStaffCommand(ctx, c); !errors.Is(err, employees.ErrStaffForbidden) {
		t.Fatalf("identity manage bypass %v", err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO manager_grants(employee_id,grant_code) VALUES($1,'identity.manage')`, f.actor.ID); err != nil {
		t.Fatal(err)
	}
	c.Email = f.actor.Email
	if _, _, err := f.access.ManagerStaffCommand(ctx, c); !errors.Is(err, employees.ErrConflict) {
		t.Fatalf("existing identity reset %v", err)
	}
	if _, _, err := f.manager.Login(ctx, f.actor.Email, "fixture-password", "127.0.0.1", ""); err != nil {
		t.Fatalf("existing password changed %v", err)
	}
	c.Grants = []auth.ManagerGrant{auth.GrantClientsRead, auth.GrantClientsRead}
	if _, _, err := f.access.ManagerStaffCommand(ctx, c); !errors.Is(err, employees.ErrStaffInvalid) {
		t.Fatalf("duplicate grant accepted %v", err)
	}
}

func TestManagerStaffQueuedCommandChecksCurrentExpiry(t *testing.T) {
	f := newStaffFixture(t)
	ctx := context.Background()
	command, _, _ := f.invite(t, "expiry@example.invalid", []auth.ManagerGrant{auth.GrantClientsRead})
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `LOCK TABLE manager_grants IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(250 * time.Millisecond)
	if _, err := tx.Exec(ctx, `UPDATE sessions SET expires_at=$2 WHERE id=$1`, f.p.SessionID, expires); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, _, err := f.access.ManagerStaffCommand(ctx, command); done <- err }()
	deadline := time.Now().Add(3 * time.Second)
	for {
		var waiting bool
		if err := f.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'LOCK TABLE manager_grants%')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("command never queued")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if delay := time.Until(expires.Add(30 * time.Millisecond)); delay > 0 {
		time.Sleep(delay)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("queued command accepted expired session %v", err)
	}
}
