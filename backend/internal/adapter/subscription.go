package adapter

import (
	"context"
	"time"
)

// Subscription is a commercial fact about an account: plan, term, state and
// the capabilities the plan provides. It is deliberately separate from Grant,
// which is the technical service grant of an integration.
type Subscription struct {
	Plan         string
	State        State
	ExpiresAt    *time.Time
	Capabilities []string
}

// SubscriptionBackend is optional: backends without subscription data stay
// valid adapters and the account card shows unknown instead of an error.
type SubscriptionBackend interface {
	GetSubscription(ctx context.Context, actor Actor, accountID int64) (Observation[Subscription], error)
}

// AsSubscription returns the subscription interface only when the backend both
// declares the capability and implements the interface.
func AsSubscription(backend Backend) (SubscriptionBackend, bool) {
	if backend == nil || !backend.Capabilities().Subscriptions {
		return nil, false
	}
	subscription, ok := backend.(SubscriptionBackend)
	if !ok {
		return nil, false
	}
	return subscription, true
}
