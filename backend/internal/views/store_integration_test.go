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
	store := NewStore(pool, 2*time.Second)
	personal, err := store.Create(ctx, CreateInput{
		OwnerEmployeeID: &owner.ID, Section: SectionAccounts, Name: "reauth",
		Params: json.RawMessage(`{"problem":"reauth_required"}`), Columns: json.RawMessage(`["account"]`),
	})
	if err != nil {
		t.Fatal(err)
	}
	shared, err := store.Create(ctx, CreateInput{
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
	_, err = store.Create(ctx, CreateInput{Section: SectionAccounts, Name: "all-active"})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("shared unique: %v", err)
	}
	if err := store.Delete(ctx, personal.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(ctx, personal.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted: %v", err)
	}
}
