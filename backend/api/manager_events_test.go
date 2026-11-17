package api

import (
	"net/http"
	"reflect"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
)

func TestManagerEventsContract(t *testing.T) {
	loader := openapi3.NewLoader()
	browser, err := loader.LoadFromFile("openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	owner, err := LoadPlatformContract()
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []struct{ path, grant string }{{"/feed", "feed.read"}, {"/accounts/{id}/history", "clients.read"}} {
		t.Run(route.path, func(t *testing.T) {
			public := browser.Paths.Find("/api/v1/managers" + route.path).GetOperation(http.MethodGet)
			private := owner.Paths.Find("/internal/platform/v1/managers" + route.path).GetOperation(http.MethodGet)
			if public == nil || public.Extensions["x-manager-grant"] != route.grant || private.Extensions["x-platform-grant"] != route.grant {
				t.Fatal("event route or grant differs from owner")
			}
			if public.Security == nil || len(*public.Security) != 1 || len((*public.Security)[0]) != 1 {
				t.Fatal("manager session required")
			}
			if _, ok := (*public.Security)[0]["managerSession"]; !ok {
				t.Fatal("manager session required")
			}
			queries := map[string]*openapi3.Parameter{}
			for _, p := range public.Parameters {
				if p.Value.In == "query" {
					queries[p.Value.Name] = p.Value
				}
				if p.Value.Name == "X-Platform-Actor" {
					t.Fatal("actor must stay server-side")
				}
			}
			for _, p := range private.Parameters {
				if p.Value.In == "query" {
					if !reflect.DeepEqual(queries[p.Value.Name], p.Value) {
						t.Fatalf("query %s differs from owner", p.Value.Name)
					}
					delete(queries, p.Value.Name)
				}
			}
			if len(queries) != 0 {
				t.Fatal("extra browser event filters")
			}
			if public.Responses.Status(200).Value.Content["application/json"].Schema.Ref != "#/components/schemas/ManagerEventList" || public.RequestBody != nil || public.Responses.Status(202) != nil {
				t.Fatal("event list must be readonly")
			}
		})
	}
	for _, name := range []string{"Event", "EventList"} {
		assertManagerProductSchema(t, browser.Components.Schemas["Manager"+name].Value, owner.Components.Schemas[name].Value)
	}
}
