package api

import (
	"context"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"

	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
)

func TestOpenAPIContract(t *testing.T) {
	loader := openapi3.NewLoader()
	loader.IsExternalRefsAllowed = false
	document, err := loader.LoadFromFile("openapi.yaml")
	if err != nil {
		t.Fatalf("load OpenAPI contract: %v", err)
	}
	if err := document.Validate(context.Background()); err != nil {
		t.Fatalf("validate OpenAPI contract: %v", err)
	}

	expected := make(map[string][]string, len(apicontract.Routes))
	for _, route := range apicontract.Routes {
		expected[route.Path] = append(expected[route.Path], route.Method)
	}
	if document.Paths.Len() != len(expected) {
		t.Fatalf("OpenAPI paths = %d, expected %d", document.Paths.Len(), len(expected))
	}
	for path, methods := range expected {
		item := document.Paths.Find(path)
		if item == nil {
			t.Errorf("OpenAPI path %s is missing", path)
			continue
		}
		operations := item.Operations()
		if len(operations) != len(methods) {
			t.Errorf("OpenAPI path %s methods = %v, expected %v", path, operations, methods)
			continue
		}
		for _, method := range methods {
			if item.GetOperation(method) == nil {
				t.Errorf("OpenAPI operation %s %s is missing", method, path)
			}
		}
	}

	scheme := document.Components.SecuritySchemes["adminSession"]
	if scheme == nil || scheme.Value == nil ||
		scheme.Value.Type != "apiKey" || scheme.Value.In != "cookie" ||
		scheme.Value.Name != "admin_session" {
		t.Fatalf("adminSession security scheme = %+v, want cookie admin_session", scheme)
	}
}

func TestCRMUsersContractRejectsContactFields(t *testing.T) {
	document, err := openapi3.NewLoader().LoadFromFile("openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	schema := document.Components.Schemas["AccountCRMUsers"].Value
	valid := func() map[string]any {
		return map[string]any{
			"source": "core", "observed_at": "2026-11-06T10:00:00Z", "freshness": "fresh",
			"data": map[string]any{
				"state": "ok", "fresh_until": "2026-11-06T10:05:00Z", "retry_after_seconds": nil, "total": 1,
				"connection": map[string]any{"id": "f1a00000-0000-4000-8000-000000000001", "integration_id": "11111111-1111-4111-8111-111111111111", "integration_code": "widget-fixture-a"},
				"users":      []any{map[string]any{"id": 501, "name": "Fixture User A", "is_active": true, "is_admin": true}},
			},
		}
	}
	if err = schema.VisitJSON(valid()); err != nil {
		t.Fatal(err)
	}
	unknown := valid()
	data := unknown["data"].(map[string]any)
	data["state"], data["users"], data["total"], data["fresh_until"], data["connection"] = "no_authorized_connection", nil, nil, nil, nil
	if err = schema.VisitJSON(unknown); err != nil {
		t.Fatalf("unknown list must be representable as null: %v", err)
	}
	withEmail := valid()
	withEmail["data"].(map[string]any)["users"] = []any{map[string]any{"id": 501, "name": "Fixture User A", "is_active": true, "is_admin": true, "email": "user@example.invalid"}}
	if err = schema.VisitJSON(withEmail); err == nil {
		t.Fatal("CRM users contract accepted a contact field")
	}
	withRights := valid()
	withRights["data"].(map[string]any)["rights"] = map[string]any{"is_admin": true}
	if err = schema.VisitJSON(withRights); err == nil {
		t.Fatal("CRM users contract accepted rights")
	}
}
