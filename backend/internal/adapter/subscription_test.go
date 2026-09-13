package adapter

import "testing"

func TestAsSubscriptionNilBackend(t *testing.T) {
	if subscription, ok := AsSubscription(nil); subscription != nil || ok {
		t.Fatalf("AsSubscription(nil)=%v,%t want nil,false", subscription, ok)
	}
}
