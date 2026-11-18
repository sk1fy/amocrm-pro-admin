package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"reflect"
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
	if count != 20 {
		t.Fatalf("manager client operations = %d, want 20", count)
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

func TestManagerProductsContract(t *testing.T) {
	loader := openapi3.NewLoader()
	browser, err := loader.LoadFromFile("openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	owner, err := loader.LoadFromFile("platform-v1-openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	routes := []struct {
		method, path, grant, success string
	}{
		{http.MethodGet, "/products", "clients.read", "200"},
		{http.MethodPost, "/products", "catalog.manage", "201"},
		{http.MethodGet, "/products/{id}", "clients.read", "200"},
		{http.MethodPatch, "/products/{id}", "catalog.manage", "200"},
		{http.MethodGet, "/products/{id}/metrics", "stats.read", "200"},
	}
	var count int
	for path, item := range browser.Paths.Map() {
		if strings.HasPrefix(path, apicontract.ManagerPrefix+"/products") && !strings.HasSuffix(path, "/company-workflow") {
			count += len(item.Operations())
		}
	}
	if count != len(routes) {
		t.Fatalf("manager product operations = %d, want %d", count, len(routes))
	}
	for _, route := range routes {
		t.Run(route.method+route.path, func(t *testing.T) {
			public := browser.Paths.Find(apicontract.ManagerPrefix + route.path).GetOperation(route.method)
			private := owner.Paths.Find("/internal/platform/v1/managers" + route.path).GetOperation(route.method)
			if public == nil || private == nil {
				t.Fatal("missing product operation")
			}
			if public.Extensions["x-manager-grant"] != route.grant || private.Extensions["x-platform-grant"] != route.grant {
				t.Fatal("product grant differs from the owner")
			}
			if public.Security == nil || len(*public.Security) != 1 || len((*public.Security)[0]) != 1 {
				t.Fatal("product route must require only the manager session")
			}
			if _, ok := (*public.Security)[0]["managerSession"]; !ok {
				t.Fatal("missing manager session")
			}
			headers := map[string]*openapi3.Parameter{}
			queries := map[string]*openapi3.Parameter{}
			for _, parameter := range public.Parameters {
				if parameter.Value.In == "header" {
					headers[parameter.Value.Name] = parameter.Value
				}
				if parameter.Value.In == "query" {
					queries[parameter.Value.Name] = parameter.Value
				}
			}
			for _, parameter := range private.Parameters {
				if parameter.Value.In == "query" {
					if !reflect.DeepEqual(queries[parameter.Value.Name], parameter.Value) {
						t.Fatalf("query %s differs from the owner", parameter.Value.Name)
					}
					delete(queries, parameter.Value.Name)
				}
			}
			if len(queries) != 0 {
				t.Fatal("unexpected browser query filters")
			}
			writes := route.method != http.MethodGet
			for _, name := range []string{"Idempotency-Key", "Origin", "X-Requested-With"} {
				parameter := headers[name]
				if (parameter != nil) != writes || (parameter != nil && !parameter.Required) {
					t.Fatalf("invalid command header %s", name)
				}
			}
			if headers["X-Platform-Actor"] != nil || (headers["If-Match"] != nil) != (route.method == http.MethodPatch) {
				t.Fatal("invalid actor or concurrency headers")
			}
			if writes && headers["Idempotency-Key"].Schema.Value.Format != "uuid" {
				t.Fatal("idempotency key must be a UUID")
			}
			success := public.Responses.Value(route.success)
			if success == nil {
				t.Fatalf("missing successful status %s", route.success)
			}
			ownerSuccess := private.Responses.Value(route.success)
			responseRef := ownerSuccess.Value.Content["application/json"].Schema.Ref
			responseRef = strings.Replace(responseRef, "#/components/schemas/", "#/components/schemas/Manager", 1)
			if success.Value.Content["application/json"].Schema.Ref != responseRef {
				t.Fatal("successful response must use the owner product shape")
			}
			if writes || route.path == "/products/{id}" {
				etag := public.Responses.Value(route.success).Value.Headers["ETag"]
				if etag == nil || etag.Value.Schema.Value.Pattern != `^"[1-9][0-9]*"$` {
					t.Fatal("missing strong product version ETag")
				}
			}
			accepted := public.Responses.Status(http.StatusAccepted)
			if (accepted != nil) != writes {
				t.Fatal("only writes may have unknown outcomes")
			}
			if writes {
				if accepted.Value.Headers["Location"] == nil || accepted.Value.Headers["Retry-After"] == nil ||
					accepted.Value.Content["application/json"].Schema.Ref != "#/components/schemas/ManagerOperation" {
					t.Fatal("unknown outcome must use the manager operation poll contract")
				}
				assertManagerProductSchema(t, public.RequestBody.Value.Content["application/json"].Schema.Value,
					private.RequestBody.Value.Content["application/json"].Schema.Value)
			}
		})
	}
	for _, name := range []string{"Product", "ProductCode", "ProductList", "TrialPolicy", "ProductMetrics"} {
		t.Run(name, func(t *testing.T) {
			assertManagerProductSchema(t, browser.Components.Schemas["Manager"+name].Value, owner.Components.Schemas[name].Value)
		})
	}
}

func assertManagerProductSchema(t *testing.T, browser, owner *openapi3.Schema) {
	t.Helper()
	normalize := func(schema *openapi3.Schema) any {
		encoded, err := json.Marshal(schema)
		if err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"Product", "ProductCode", "ProductList", "TrialPolicy", "ProductMetrics", "Event", "EventList", "AmoID", "Version", "SetProductCompanyWorkflow", "ProductCompanyWorkflow", "CompanyWorkflowConfiguration", "CompanySource", "CompanyProjectionId", "CompanySummary", "CompanyRuntimeAccount", "CompanyContact", "CompanyContactLink", "CompanyWorkflowPipeline", "CompanyWorkflowStage"} {
			encoded = bytes.ReplaceAll(encoded, []byte("#/components/schemas/Manager"+name+`"`), []byte("#/components/schemas/"+name+`"`))
		}
		var value any
		if err := json.Unmarshal(encoded, &value); err != nil {
			t.Fatal(err)
		}
		var stripDescriptions func(any)
		stripDescriptions = func(value any) {
			switch value := value.(type) {
			case map[string]any:
				delete(value, "description")
				for _, child := range value {
					stripDescriptions(child)
				}
			case []any:
				for _, child := range value {
					stripDescriptions(child)
				}
			}
		}
		stripDescriptions(value)
		return value
	}
	if !reflect.DeepEqual(normalize(browser), normalize(owner)) {
		t.Fatal("browser product schema differs from the pinned owner schema")
	}
}
