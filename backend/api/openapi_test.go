package api

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"

	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
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

	for name, cookie := range map[string]string{"adminSession": auth.CookieName, "managerSession": auth.ManagerCookieName} {
		scheme := document.Components.SecuritySchemes[name]
		if scheme == nil || scheme.Value == nil ||
			scheme.Value.Type != "apiKey" || scheme.Value.In != "cookie" ||
			scheme.Value.Name != cookie {
			t.Fatalf("security scheme %s = %+v, want cookie %s", name, scheme, cookie)
		}
	}
	managerSchema := document.Components.Schemas["ManagerMe"].Value
	enum := managerSchema.Properties["grants"].Value.Items.Value.Enum
	grants := auth.ManagerAdminGrants()
	if len(enum) != len(grants) {
		t.Fatalf("manager grant count = %d, want %d", len(enum), len(grants))
	}
	for i, grant := range grants {
		if enum[i] != string(grant) {
			t.Fatalf("manager grant at %d = %v, want %s", i, enum[i], grant)
		}
	}
}

func TestManagerClientsContractSeparatesSearchAndCommands(t *testing.T) {
	loader := openapi3.NewLoader()
	browser, err := loader.LoadFromFile("openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	owner, err := loader.LoadFromFile("platform-v1-openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var count int
	for _, route := range apicontract.Routes {
		suffix, ok := strings.CutPrefix(route.Path, apicontract.ManagerPrefix)
		if !ok || (!strings.HasPrefix(suffix, "/accounts") && !strings.HasPrefix(suffix, "/portrait-")) {
			continue
		}
		count++
		public := browser.Paths.Find(route.Path).GetOperation(route.Method)
		private := owner.Paths.Find("/internal/platform/v1/managers" + suffix).GetOperation(route.Method)
		if public.Extensions["x-manager-grant"] != private.Extensions["x-platform-grant"] ||
			public.Security == nil || len(*public.Security) != 1 {
			t.Fatalf("browser route has a different grant or security requirement: %s %s", route.Method, route.Path)
		}
		if _, ok := (*public.Security)[0]["managerSession"]; !ok {
			t.Fatalf("browser route has no manager session: %s", route.Path)
		}
		headers := map[string]bool{}
		for _, parameter := range public.Parameters {
			if parameter.Value.In == "header" {
				headers[parameter.Value.Name] = true
			}
		}
		writes := route.Method != http.MethodGet && suffix != "/accounts/search"
		usesCSRF := route.Method != http.MethodGet
		if headers["X-Platform-Actor"] || headers["Idempotency-Key"] != writes ||
			headers["X-Requested-With"] != usesCSRF || headers["Origin"] != usesCSRF ||
			(public.Responses.Status(http.StatusAccepted) != nil) != writes {
			t.Fatalf("browser route has wrong command or CSRF headers: %s %s", route.Method, route.Path)
		}
	}
	if count != 19 {
		t.Fatalf("manager client operations = %d, want 19", count)
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
