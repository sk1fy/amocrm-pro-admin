package rbac

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
)

type stubLookup struct {
	employee Employee
	err      error
}

func (s stubLookup) Get(context.Context, uuid.UUID) (Employee, error) {
	return s.employee, s.err
}

func TestRequireSeparatesInfrastructureFailureFromAccess(t *testing.T) {
	id := uuid.New()
	tests := []struct {
		name   string
		lookup stubLookup
		want   int
	}{
		{"active with permission", stubLookup{employee: Employee{ID: id, Role: RoleViewer, Status: auth.StatusActive}}, http.StatusOK},
		{"active without permission", stubLookup{employee: Employee{ID: id, Role: RoleViewer, Status: auth.StatusActive}}, http.StatusForbidden},
		{"disabled", stubLookup{employee: Employee{ID: id, Role: RoleAdmin, Status: auth.StatusDisabled}}, http.StatusUnauthorized},
		{"not found", stubLookup{err: ErrEmployeeNotFound}, http.StatusUnauthorized},
		{"admin DB failure", stubLookup{err: errors.New("connection refused")}, http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			permission := AccountsRead
			if tt.name == "active without permission" {
				permission = EmployeesWrite
			}
			handler := Require(permission, tt.lookup)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req = req.WithContext(auth.ContextWithPrincipal(req.Context(), auth.Principal{EmployeeID: id}))
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tt.want {
				t.Fatalf("status=%d, want %d", rec.Code, tt.want)
			}
		})
	}
}
