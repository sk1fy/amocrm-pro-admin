package fixture

import (
	"context"
	"testing"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

func TestDemoSeedsLabelledAccounts(t *testing.T) {
	fx := Demo("core")
	if fx.Descriptor().Code != "core" || fx.Descriptor().Kind != adapter.KindFixture {
		t.Fatalf("descriptor=%+v", fx.Descriptor())
	}
	page, err := fx.ListAccounts(context.Background(), adapter.Actor{}, adapter.AccountFilter{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if page.Data == nil || page.Data.Total == nil || *page.Data.Total != 6 {
		t.Fatalf("accounts=%+v", page.Data)
	}
	var two *adapter.Account
	for i := range page.Data.Items {
		if page.Data.Items[i].AccountID == 91000002 {
			two = &page.Data.Items[i]
		}
		if page.Data.Items[i].Origin != adapter.OriginFixture {
			t.Fatalf("origin=%s", page.Data.Items[i].Origin)
		}
	}
	if two == nil || len(two.Connections) != 2 {
		t.Fatalf("account 91000002=%+v", two)
	}
	states := map[string]string{}
	for _, conn := range two.Connections {
		states[conn.ID] = conn.Status.Canonical
	}
	if states[installationID(3)] != adapter.StatusReauthRequired || states[installationID(4)] != adapter.StatusActive {
		t.Fatalf("states=%v", states)
	}
	found, err := fx.ListAccounts(context.Background(), adapter.Actor{}, adapter.AccountFilter{Query: "fixture-two", Limit: 10})
	if err != nil || found.Data == nil || len(found.Data.Items) != 1 {
		t.Fatalf("subdomain search: %+v %v", found.Data, err)
	}
}
