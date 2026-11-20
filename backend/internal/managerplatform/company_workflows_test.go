package managerplatform

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

func TestWorkflowIdentityVersionAndGrant(t *testing.T) {
	id := uuid.New()
	var model wire.ProductCompanyWorkflow
	raw := []byte(`{"product_id":"` + id.String() + `","version":1,"configuration":null,"write_ready":false}`)
	if err := json.Unmarshal(raw, &model); err != nil {
		t.Fatal(err)
	}
	if !validCompanyWorkflow(&model, id, intent{}) || validCompanyWorkflow(&model, uuid.New(), intent{}) || validCompanyWorkflow(&model, id, intent{Kind: kindCompanyWorkflow, Version: 1}) {
		t.Fatal("virtual version identity")
	}
	if kindCompanyWorkflow.policy().grant != "catalog.manage" || kindCompanyWorkflow.pollGrant() != "catalog.manage" {
		t.Fatal("catalog-only receipt must work")
	}
	if !kindCompanyWorkflow.policy().validates(CommandMeta{TargetID: id, ExpectedVersion: 1, IdempotencyKey: uuid.New()}) {
		t.Fatal("workflow command target/version")
	}
	for _, value := range []string{"0", "01", "-1", "9223372036854775808", "1.0"} {
		if validCRMID(value) {
			t.Fatalf("noncanonical CRM ID %s", value)
		}
	}
}
