package httpapi

import (
	"encoding/json"
	"testing"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

func TestWebhookDTORegistryCountNullAndZero(t *testing.T) {
	positive := 2
	for _, tc := range []struct {
		name  string
		count *int
		want  string
	}{
		{name: "missing", want: "null"},
		{name: "zero", count: new(int), want: "0"},
		{name: "positive", count: &positive, want: "2"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dto := toWebhookDTO(adapter.Webhook{ConfirmedDestinations: tc.count})
			body, err := json.Marshal(dto)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(body, &fields); err != nil {
				t.Fatal(err)
			}
			if got := string(fields["confirmed_destinations"]); got != tc.want {
				t.Fatalf("confirmed_destinations=%s want=%s", got, tc.want)
			}
		})
	}
}
