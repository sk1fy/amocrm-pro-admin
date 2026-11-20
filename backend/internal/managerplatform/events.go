package managerplatform

import (
	"encoding/hex"
	"net/url"
	"slices"
	"strconv"

	"github.com/google/uuid"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

func validManagerEvents(page *wire.EventList, target uuid.UUID, query url.Values) bool {
	hash, err := hex.DecodeString(page.QueryHash)
	cursor, cursorErr := page.NextCursor.Get()
	limit := 25
	if requested := query.Get("limit"); requested != "" {
		limit, _ = strconv.Atoi(requested)
	}
	if err != nil || len(hash) != 32 || page.Items == nil || page.SnapshotAt.IsZero() ||
		!page.NextCursor.IsSpecified() || (cursorErr == nil && (cursor == "" || len(cursor) > 1024 || cursor == query.Get("cursor"))) || len(page.Items) > limit {
		return false
	}
	if target == uuid.Nil && query.Get("account_id") != "" {
		target, _ = uuid.Parse(query.Get("account_id"))
	}
	product, _ := uuid.Parse(query.Get("product_id"))
	seen := make(map[uuid.UUID]bool, len(page.Items))
	for _, event := range page.Items {
		if event.Id == uuid.Nil || seen[event.Id] || !event.Kind.Valid() || event.OccurredAt.IsZero() || event.RecordedAt.IsZero() ||
			event.RelatedRefs == nil || event.Summary == "" ||
			(event.AccountId != nil && *event.AccountId == uuid.Nil) ||
			(event.ProductId != nil && *event.ProductId == uuid.Nil) ||
			(target != uuid.Nil && (event.AccountId == nil || *event.AccountId != target)) ||
			(product != uuid.Nil && (event.ProductId == nil || *event.ProductId != product)) ||
			(len(query["kind"]) != 0 && !slices.Contains(query["kind"], string(event.Kind))) {
			return false
		}
		seen[event.Id] = true
		refs := make(map[wire.EventRelatedRefsKind]map[uuid.UUID]bool)
		for _, ref := range event.RelatedRefs {
			if ref.Id == uuid.Nil || !ref.Kind.Valid() ||
				(ref.Kind == wire.EventRelatedRefsKindAccount && (event.AccountId == nil || ref.Id != *event.AccountId)) ||
				(ref.Kind == wire.EventRelatedRefsKindProduct && (event.ProductId == nil || ref.Id != *event.ProductId)) {
				return false
			}
			if refs[ref.Kind] == nil {
				refs[ref.Kind] = make(map[uuid.UUID]bool)
			}
			if refs[ref.Kind][ref.Id] {
				return false
			}
			refs[ref.Kind][ref.Id] = true
		}
		if (event.AccountSubdomain != nil && (event.AccountId == nil || !refs[wire.EventRelatedRefsKindAccount][*event.AccountId])) ||
			(event.ProductDisplayName != nil && (event.ProductId == nil || !refs[wire.EventRelatedRefsKindProduct][*event.ProductId])) {
			return false
		}
	}
	return true
}
