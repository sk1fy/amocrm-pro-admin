package fixture

import (
	"context"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

func (a *Adapter) GetSubscription(ctx context.Context, _ adapter.Actor, accountID int64) (adapter.Observation[adapter.Subscription], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.Subscriptions); err != nil {
		return adapter.Observation[adapter.Subscription]{}, err
	}
	known := false
	for _, account := range data.Accounts {
		if account.AccountID == accountID {
			known = true
			break
		}
	}
	if !known {
		return adapter.Observation[adapter.Subscription]{}, adapter.NotFound(a.desc.Code, "account not found")
	}
	subscription, ok := data.Subscriptions[accountID]
	if !ok {
		return adapter.Observation[adapter.Subscription]{}, adapter.NotFound(a.desc.Code, "subscription not found")
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), subscription), nil
}
