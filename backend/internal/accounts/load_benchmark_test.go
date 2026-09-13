package accounts

import (
	"fmt"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
)

const (
	loadIntegrationAID   = "1a000000-0000-4000-8000-000000000001"
	loadIntegrationBID   = "1a000000-0000-4000-8000-000000000002"
	loadIntegrationACode = "load-widget-a"
	loadIntegrationBCode = "load-widget-b"
	loadAccountIDBase    = int64(700000000)
)

// BenchmarkListAccountsLarge measures the Admin API account paths against an
// in-memory fixture backend with 10^4 and 10^5 accounts (1-5 connections each)
// and no database. Sub-benchmarks cover the direct filtered list, the scan
// path used by post-filters, and GetAccount on a five-connection account.
// Benchmarks only run with -bench, so normal `go test` does not pay setup:
//
//	go test -run '^$' -bench 'BenchmarkListAccountsLarge' -benchtime=3x \
//	  -count=1 ./internal/accounts/
func BenchmarkListAccountsLarge(b *testing.B) {
	for _, size := range []int{10_000, 100_000} {
		svc := New([]adapter.Backend{fixture.New(fixture.Options{
			Code: "core", Data: generateLoadData(size),
		})}, nil)
		actor := adapter.Actor{Value: "employee:benchmark"}

		b.Run(fmt.Sprintf("filtered/N=%d", size), func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				result, err := svc.ListAccounts(b.Context(), actor, ListFilter{Q: "load-501", Limit: 25})
				if err != nil || len(result.Items) != 1 {
					b.Fatalf("items=%d err=%v", len(result.Items), err)
				}
			}
		})

		b.Run(fmt.Sprintf("scan_status/N=%d", size), func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				result, err := svc.ListAccounts(b.Context(), actor, ListFilter{
					Connection: adapter.StatusReauthRequired, Limit: 25,
				})
				if err != nil || len(result.Items) == 0 {
					b.Fatalf("items=%d err=%v", len(result.Items), err)
				}
			}
		})

		b.Run(fmt.Sprintf("get_account_5_connections/N=%d", size), func(b *testing.B) {
			b.ReportAllocs()
			accountID := loadFiveConnectionAccountID(size)
			for i := 0; i < b.N; i++ {
				card, err := svc.GetAccount(b.Context(), actor, accountID)
				if err != nil || len(card.Connections) != 5 {
					b.Fatalf("connections=%d err=%v", len(card.Connections), err)
				}
			}
		})
	}
}

func loadFiveConnectionAccountID(size int) int64 {
	index := size / 2
	index += (4 - index%5 + 5) % 5
	return loadAccountIDBase + int64(index)
}

// generateLoadData builds a realistic fixture dataset: account i has 1-5
// connections (i%5+1); connection states follow the same shape as the demo
// fixture (mostly active, reauth/error/disabled/pending/uninstalled tails),
// webhook and authorization states correlate with the connection state, and a
// deterministic fraction carries recent failed jobs so post-filters match.
func generateLoadData(size int) fixture.Data {
	now := time.Now().UTC()
	accounts := make([]adapter.Account, 0, size)
	for i := 0; i < size; i++ {
		accountID := loadAccountIDBase + int64(i)
		domain := fmt.Sprintf("load-%d.amocrm.test", i+1)
		connections := make([]adapter.ConnectionSummary, 0, 5)
		for j := 0; j < i%5+1; j++ {
			seq := i*5 + j
			status := loadConnectionStatus(seq)
			updated := now.Add(-time.Duration(seq%40000) * time.Minute)
			connections = append(connections, adapter.ConnectionSummary{
				ID:              fmt.Sprintf("1a000000-0000-4000-8000-%012x", seq),
				IntegrationID:   loadIntegrationID(seq),
				IntegrationCode: loadIntegrationCode(seq),
				AccountID:       accountID,
				AccountDomain:   domain,
				Status:          adapter.State{Canonical: status},
				WebhookStatus:   adapter.State{Canonical: loadWebhookStatus(seq)},
				Authorization:   adapter.State{Canonical: loadAuthorization(status, seq)},
				Origin:          adapter.OriginFixture,
				InstalledBy:     loadInt64Ptr(int64(500 + seq%40)),
				CreatedAt:       updated.Add(-24 * time.Hour),
				UpdatedAt:       updated,
				Grants: []adapter.Grant{
					{Service: "lead-status", State: adapter.MapGrant(seq%7 != 0)},
					{Service: "activity", State: adapter.MapGrant(seq%3 == 0)},
				},
				Pilot:            adapter.State{Canonical: loadPilotState(seq)},
				RecentFailedJobs: loadRecentFailedJobs(seq),
			})
		}
		accounts = append(accounts, adapter.Account{
			AccountID:      accountID,
			Domains:        []string{domain},
			Origin:         adapter.OriginFixture,
			LastActivityAt: now.Add(-time.Duration(i%20000) * time.Minute),
			Connections:    connections,
		})
	}
	return fixture.Data{Accounts: accounts}
}

func loadConnectionStatus(seq int) string {
	switch bucket := seq % 100; {
	case bucket < 70:
		return adapter.StatusActive
	case bucket < 80:
		return adapter.StatusReauthRequired
	case bucket < 88:
		return adapter.StatusDisabled
	case bucket < 93:
		return adapter.StatusError
	case bucket < 97:
		return adapter.StatusPending
	default:
		return adapter.StatusUninstalled
	}
}

func loadWebhookStatus(seq int) string {
	switch bucket := seq % 100; {
	case bucket < 80:
		return adapter.StatusActive
	case bucket < 88:
		return adapter.StatusError
	case bucket < 93:
		return adapter.StatusDisabled
	case bucket < 97:
		return adapter.StatusPending
	default:
		return adapter.StatusUnregistered
	}
}

func loadAuthorization(status string, seq int) string {
	switch status {
	case adapter.StatusReauthRequired:
		return adapter.AuthReauthRequired
	case adapter.StatusDisabled, adapter.StatusUninstalled:
		return ""
	case adapter.StatusPending:
		return adapter.AuthMissing
	default:
		if seq%17 == 0 {
			return adapter.AuthMissing
		}
		return adapter.AuthValid
	}
}

func loadPilotState(seq int) string {
	switch seq % 4 {
	case 0:
		return adapter.PilotEnabled
	case 1:
		return adapter.PilotDisabled
	default:
		return adapter.PilotNotConfigured
	}
}

func loadRecentFailedJobs(seq int) int {
	switch {
	case seq%23 == 0:
		return 4
	case seq%7 == 0:
		return 1
	default:
		return 0
	}
}

func loadIntegrationID(seq int) string {
	if seq%2 == 0 {
		return loadIntegrationAID
	}
	return loadIntegrationBID
}

func loadIntegrationCode(seq int) string {
	if seq%2 == 0 {
		return loadIntegrationACode
	}
	return loadIntegrationBCode
}

func loadInt64Ptr(value int64) *int64 { return &value }
