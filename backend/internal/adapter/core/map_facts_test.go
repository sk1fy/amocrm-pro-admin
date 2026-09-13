package core

import (
	"testing"
	"time"
)

func TestAccountSummaryCarriesListAndCardFacts(t *testing.T) {
	summary := mapAccountListItem(accountListItem{Installations: []accountInstallation{{RecentFailedJobs: 2, Grants: []grant{{Service: "activity", Enabled: true}}}}})
	if summary.Connections[0].RecentFailedJobs != 2 || len(summary.Connections[0].Grants) != 1 {
		t.Fatal("lost list facts")
	}
	card := mapCardSummary(installationCard{Installation: installationSummary{RecentFailedJobs: 2}, Authorization: authorization{State: "valid", CredentialsPresent: true, Unverified: true}})
	if card.RecentFailedJobs != 2 || card.AuthorizationDetails == nil || !card.AuthorizationDetails.Unverified || !card.AuthorizationDetails.CredentialsPresent {
		t.Fatalf("lost card facts %+v", card)
	}
}

func TestRowCursorsUseBackendSortKeys(t *testing.T) {
	at := time.Date(2026, 9, 13, 10, 0, 0, 123000, time.UTC)
	if got := mapJob(job{ID: "job-id", CreatedAt: at.Add(-time.Hour), UpdatedAt: at}); got.Cursor != rowCursor(at, "job-id") {
		t.Fatal("job cursor must use updated_at")
	}
	if got := mapAudit(auditEntry{ID: 123, CreatedAt: at}); got.Cursor != rowCursor(at, "123") {
		t.Fatal("audit cursor must use timestamp and numeric ID")
	}
}
