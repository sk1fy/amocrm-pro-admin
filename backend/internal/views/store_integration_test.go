package views

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
	"github.com/sk1fy/amocrm-pro-admin/internal/testkit"
)

func TestSavedViewsPersonalAndShared(t *testing.T) {
	pool := testkit.Postgres(t)
	testkit.Reset(t, pool)
	ctx := t.Context()
	employeesStore := employees.NewStore(pool, 2*time.Second)
	hash, err := auth.Hash("correct-horse-battery")
	if err != nil {
		t.Fatal(err)
	}
	owner, err := employeesStore.Create(ctx, employees.CreateInput{
		Email: "owner@example.invalid", Name: "Owner", Role: rbac.RoleOperator, PasswordHash: hash,
	})
	if err != nil {
		t.Fatal(err)
	}
	other, err := employeesStore.Create(ctx, employees.CreateInput{
		Email: "other@example.invalid", Name: "Other", Role: rbac.RoleOperator, PasswordHash: hash,
	})
	if err != nil {
		t.Fatal(err)
	}
	admin, err := employeesStore.Create(ctx, employees.CreateInput{
		Email: "admin@example.invalid", Name: "Admin", Role: rbac.RoleAdmin, PasswordHash: hash,
	})
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(pool, 2*time.Second)
	ownerActor := Actor{EmployeeID: owner.ID, Role: rbac.RoleOperator}
	otherActor := Actor{EmployeeID: other.ID, Role: rbac.RoleOperator}
	adminActor := Actor{EmployeeID: admin.ID, Role: rbac.RoleAdmin}

	if CanCreate(ownerActor, nil) || CanCreate(ownerActor, &other.ID) {
		t.Fatal("operator must not create shared or foreign views")
	}
	if !CanCreate(adminActor, nil) || !CanCreate(ownerActor, &owner.ID) {
		t.Fatal("admin shared and owner personal create ACL")
	}

	personal, err := store.Create(ctx, ownerActor, CreateInput{
		OwnerEmployeeID: &owner.ID, Section: SectionAccounts, Name: "reauth",
		Params: json.RawMessage(`{"problem":"reauth_required"}`), Columns: json.RawMessage(`["account"]`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(ctx, ownerActor, CreateInput{
		OwnerEmployeeID: &other.ID, Section: SectionAccounts, Name: "foreign-personal",
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("operator foreign personal view: %v", err)
	}
	if _, err := store.Create(ctx, ownerActor, CreateInput{
		Section: SectionAccounts, Name: "all-active",
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("operator shared view: %v", err)
	}
	if items, err := store.List(ctx, other.ID, SectionAccounts); err != nil || len(items) != 0 {
		t.Fatalf("no shared row must exist: items=%+v err=%v", items, err)
	}

	shared, err := store.Create(ctx, adminActor, CreateInput{
		Section: SectionAccounts, Name: "all-active",
		Params: json.RawMessage(`{"connection":"active"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	owned, err := store.List(ctx, owner.ID, SectionAccounts)
	if err != nil || len(owned) != 2 {
		t.Fatalf("owner list=%d err=%v", len(owned), err)
	}
	otherList, err := store.List(ctx, other.ID, SectionAccounts)
	if err != nil || len(otherList) != 1 || otherList[0].ID != shared.ID {
		t.Fatalf("other list=%+v err=%v", otherList, err)
	}
	if CanWrite(personal, owner.ID, rbac.RoleOperator) != true || CanWrite(personal, other.ID, rbac.RoleOperator) {
		t.Fatal("personal write ACL")
	}
	if CanWrite(shared, owner.ID, rbac.RoleOperator) || !CanWrite(shared, other.ID, rbac.RoleAdmin) {
		t.Fatal("shared write ACL")
	}
	if _, err := store.Create(ctx, adminActor, CreateInput{Section: SectionAccounts, Name: "all-active"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("shared unique: %v", err)
	}

	renamed := "renamed"
	if _, err := store.Update(ctx, ownerActor, shared.ID, UpdateInput{Name: &renamed}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("operator update shared: %v", err)
	}
	if err := store.Delete(ctx, ownerActor, shared.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("operator delete shared: %v", err)
	}
	if _, err := store.Update(ctx, otherActor, personal.ID, UpdateInput{Name: &renamed}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("operator update foreign personal: %v", err)
	}
	if err := store.Delete(ctx, otherActor, personal.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("operator delete foreign personal: %v", err)
	}
	updated, err := store.Update(ctx, ownerActor, personal.ID, UpdateInput{Name: &renamed})
	if err != nil || updated.Name != renamed {
		t.Fatalf("owner update personal: %+v err=%v", updated, err)
	}
	if _, err := store.Update(ctx, adminActor, shared.ID, UpdateInput{Name: &renamed}); err != nil {
		t.Fatalf("admin update shared: %v", err)
	}
	if err := store.Delete(ctx, adminActor, shared.ID); err != nil {
		t.Fatalf("admin delete shared: %v", err)
	}
	if items, err := store.List(ctx, other.ID, SectionAccounts); err != nil || len(items) != 0 {
		t.Fatalf("shared must be deleted: items=%+v err=%v", items, err)
	}
	if err := store.Delete(ctx, ownerActor, personal.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(ctx, personal.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted: %v", err)
	}
}
