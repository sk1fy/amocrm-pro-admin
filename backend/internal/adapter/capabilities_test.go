package adapter

import (
	"slices"
	"testing"
)

func TestCapabilitiesNames(t *testing.T) {
	all := Capabilities{
		Accounts: true, Connections: true, Integrations: true, Jobs: true, Audit: true,
		Diagnostics: true, Commands: true, Settings: true, Stats: true,
		ActivityDeliveries: true, Subscriptions: true,
	}
	tests := []struct {
		name string
		caps Capabilities
		want []string
	}{
		{
			name: "none",
			caps: Capabilities{},
			want: []string{},
		},
		{
			name: "single capability",
			caps: Capabilities{Accounts: true},
			want: []string{"accounts"},
		},
		{
			name: "subscriptions only",
			caps: Capabilities{Subscriptions: true},
			want: []string{"subscriptions"},
		},
		{
			name: "module without optional capabilities",
			caps: Capabilities{Accounts: true, Connections: true, Integrations: true, Audit: true},
			want: []string{"accounts", "connections", "integrations", "audit"},
		},
		{
			name: "all capabilities in contract order",
			caps: all,
			want: []string{
				"accounts", "connections", "integrations", "jobs", "audit", "diagnostics",
				"commands", "settings", "stats", "activity-deliveries", "subscriptions",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.caps.Names()
			if got == nil {
				t.Fatal("Names() must return an empty slice, not nil")
			}
			if !slices.Equal(got, tt.want) {
				t.Fatalf("Names()=%v want %v", got, tt.want)
			}
		})
	}
}
