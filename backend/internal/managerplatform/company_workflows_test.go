package managerplatform

import (
	"encoding/json"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

func TestCompanyObservationsPreserveAbsenceAndOldProvenance(t *testing.T) {
	now := time.Now().UTC()
	for _, test := range []struct {
		name, state     string
		complete        bool
		items           any
		observed, fresh any
		want            bool
	}{
		{"no data", "error", false, nil, nil, nil, true},
		{"complete empty", "fresh", true, []any{}, now, now.Add(time.Hour), true},
		{"partial is not empty", "error", false, []any{}, nil, nil, false},
		{"stale full retained", "stale", true, []any{}, now.Add(-time.Hour), now.Add(-time.Minute), true},
		{"error full retained", "error", true, []any{}, now.Add(-time.Hour), now.Add(-time.Minute), true},
		{"disabled absent", "disabled", false, nil, nil, nil, true},
		{"fresh absent", "fresh", false, nil, nil, nil, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{"items": test.items, "next_cursor": nil, "source": map[string]any{"source_account_id": "71", "binding_revision": "fixture", "state": test.state, "complete": test.complete, "observed_at": test.observed, "fresh_until": test.fresh, "error_code": nil, "retry_at": nil}})
			if err != nil {
				t.Fatal(err)
			}
			var page wire.CompanyList
			if err := json.Unmarshal(raw, &page); err != nil {
				t.Fatal(err)
			}
			if got := validCompanyList(&page, url.Values{}); got != test.want {
				t.Fatalf("valid=%v want %v", got, test.want)
			}
		})
	}
}
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
