package httpapi

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/accounts"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

func TestAccountCardPreservesAuthorizationFacts(t *testing.T) {
	expires := time.Now().UTC().Add(time.Hour)
	facts := adapter.Authorization{State: adapter.MapAuthState("valid"), CredentialsPresent: true, Unverified: true, ExpiresAt: &expires, CredentialVersion: 3}
	card := toAccountCard(accounts.AccountCard{Aggregated: accounts.Aggregated{Connections: []accounts.Connection{{Authorization: facts.State, AuthorizationDetails: &facts, ObservedAt: time.Now(), Freshness: adapter.FreshnessFresh}}}})
	raw, err := json.Marshal(card)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Connections []struct {
			Data struct {
				Authorization authorizationDTO `json:"authorization"`
			} `json:"data"`
		} `json:"connections"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	auth := got.Connections[0].Data.Authorization
	if !auth.Unverified || !auth.CredentialsPresent || auth.ExpiresAt == nil || !auth.ExpiresAt.Equal(expires) || auth.CredentialVersion != 3 {
		t.Fatalf("lost credential facts %+v", auth)
	}
}

func TestAccountSummaryDoesNotFabricateCredentialAbsence(t *testing.T) {
	value := accountAuthorization(accounts.Connection{Authorization: adapter.MapAuthState("valid")}).(map[string]any)
	if value["unverified"] != true {
		t.Fatal("missing unverified modifier")
	}
	if _, ok := value["credentials_present"]; ok {
		t.Fatal("unknown presence must not become false")
	}
}
