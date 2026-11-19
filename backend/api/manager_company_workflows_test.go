package api

import (
	"net/http"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
)

func TestManagerCompanyWorkflowContract(t *testing.T) {
	browser, err := openapi3.NewLoader().LoadFromFile("openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	owner, err := LoadPlatformContract()
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []struct{ method, path, grant string }{
		{"GET", "/companies", "clients.read"}, {"GET", "/companies/{id}", "clients.read"},
		{"GET", "/installation-deal-settings", "catalog.manage"}, {"PUT", "/installation-deal-settings", "catalog.manage"},
		{"GET", "/company-workflow-metadata", "catalog.manage"}, {"GET", "/products/{id}/company-workflow", "catalog.manage"}, {"PUT", "/products/{id}/company-workflow", "catalog.manage"},
	} {
		t.Run(route.method+route.path, func(t *testing.T) {
			public := browser.Paths.Find("/api/v1/managers" + route.path).GetOperation(route.method)
			private := owner.Paths.Find("/internal/platform/v1/managers" + route.path).GetOperation(route.method)
			if public == nil || private == nil || public.Extensions["x-manager-grant"] != route.grant || private.Extensions["x-platform-grant"] != route.grant {
				t.Fatal("route or grants differ")
			}
			if public.Security == nil || len(*public.Security) != 1 {
				t.Fatal("session required")
			}
			if _, ok := (*public.Security)[0]["managerSession"]; !ok {
				t.Fatal("manager session required")
			}
			for _, p := range public.Parameters {
				if p.Value.Name == "X-Platform-Actor" {
					t.Fatal("actor leaked")
				}
			}
			if route.method == http.MethodPut {
				for _, header := range []string{"Idempotency-Key", "If-Match", "Origin", "X-Requested-With"} {
					p := public.Parameters.GetByInAndName("header", header)
					if p == nil || !p.Required {
						t.Fatalf("missing %s", header)
					}
				}
				assertManagerProductSchema(t, public.RequestBody.Value.Content["application/json"].Schema.Value, private.RequestBody.Value.Content["application/json"].Schema.Value)
				if public.Responses.Status(202) == nil {
					t.Fatal("unknown outcome missing")
				}
			}
		})
	}
}
