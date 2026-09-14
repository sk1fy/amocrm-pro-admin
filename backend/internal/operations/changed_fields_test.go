package operations

import (
	"encoding/json"
	"slices"
	"testing"
)

func TestChangedFieldsIncludesModuleConfigurationWithoutValues(t *testing.T) {
	want := []string{
		"initial_days", "retention_days", "expected_updated_at", "kind", "from", "to",
		"name", "employee_ids", "display_window", "panel_id", "revision",
		"source_pipeline_id", "source_status_id", "target_pipeline_id",
		"target_status_id", "expected_revision", "enabled",
	}
	payload := map[string]json.RawMessage{"unrecognized": json.RawMessage(`"fixture-private-value"`)}
	for _, field := range want {
		payload[field] = json.RawMessage(`"fixture-private-value"`)
	}
	slices.Sort(want)
	if got := changedFields(payload); !slices.Equal(got, want) {
		t.Fatalf("fields=%v, want=%v", got, want)
	}
}
