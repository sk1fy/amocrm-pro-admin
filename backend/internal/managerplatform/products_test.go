package managerplatform

import (
	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/apicontract"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
	"net/http"
	"testing"
)

func TestProductPoliciesAndVersionIdentity(t *testing.T) {
	grants := map[apicontract.Route]auth.ManagerGrant{apicontract.ManagerProducts: auth.GrantCatalogRead, apicontract.ManagerProduct: auth.GrantCatalogRead, apicontract.ManagerProductCreate: auth.GrantCatalogManage, apicontract.ManagerProductUpdate: auth.GrantCatalogManage, apicontract.ManagerProductMetrics: auth.GrantStatsRead}
	for _, endpoint := range AccountEndpoints() {
		if want, ok := grants[endpoint.Route]; ok {
			if endpoint.Grant() != want {
				t.Errorf("%v grant %s", endpoint.Route, endpoint.Grant())
			}
			delete(grants, endpoint.Route)
		}
	}
	if len(grants) != 0 {
		t.Fatal("missing product endpoints")
	}
	id := uuid.New()
	key := uuid.New()
	if !kindCreateProduct.policy().validates(CommandMeta{IdempotencyKey: key}) || kindCreateProduct.policy().validates(CommandMeta{IdempotencyKey: key, TargetID: id}) {
		t.Fatal("create binding policy")
	}
	if !kindUpdateProduct.policy().validates(CommandMeta{IdempotencyKey: key, TargetID: id, ExpectedVersion: 7}) {
		t.Fatal("update binding policy")
	}
	for _, test := range []struct {
		name    string
		id      uuid.UUID
		version int
		want    bool
	}{{"no-op", id, 7, true}, {"new version", id, 9, true}, {"stale", id, 6, false}, {"wrong target", uuid.New(), 8, false}, {"nil identity", uuid.Nil, 8, false}} {
		t.Run(test.name, func(t *testing.T) {
			model := &wire.Product{Id: test.id, Version: test.version}
			got := validManagerAccountDTO(model, id, nil, nil, &http.Response{}, intent{Version: 7})
			if got != test.want {
				t.Fatalf("valid %t want %t", got, test.want)
			}
			if accountResponseVersion(model) != test.version {
				t.Fatal("product ETag must use product version")
			}
		})
	}
}
