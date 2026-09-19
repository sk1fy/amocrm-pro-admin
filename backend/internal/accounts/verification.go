package accounts

import (
	"context"
	"encoding/json"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"strings"
)

const exhaustedVerificationStream = "verification:end"
const verificationScanPages = 4

// Push the predicate into capable sources. Old v1 sources may ignore the new
// parameter: at most four native pages are scanned, with a continuation even
// when no rows match. No filtered suffix is dropped and no total is invented.
func (s *Service) verificationAccounts(ctx context.Context, actor adapter.Actor, f ListFilter, limit int) (ListResult, error) {
	streams := []pageStream[Aggregated]{}
	participating := map[string]bool{}
	for _, b := range s.accountBackends(f.Backend) {
		participating[b.Descriptor().Code] = true
	}
	query := NormalizeQuery(f.Q)
	for _, backend := range s.accountBackends(f.Backend) {
		code := backend.Descriptor().Code
		streams = append(streams, pageStream[Aggregated]{ID: code, Backend: code, Timeout: backend.Descriptor().Timeout, Read: func(ctx context.Context, limit int, cursor string) (streamPage[Aggregated], error) {
			page := streamPage[Aggregated]{}
			if cursor == exhaustedVerificationStream {
				return page, nil
			}
			for scan := 0; scan < verificationScanPages; scan++ {
				obs, err := backend.ListAccounts(ctx, actor, adapter.AccountFilter{Query: NormalizeQuery(f.Q).CoreQ(), IntegrationID: f.IntegrationID, Verification: f.Verification, Limit: 100, Cursor: cursor})
				if err != nil {
					return page, err
				}
				if obs.Data == nil {
					return page, adapter.Unavailable(code, "account data unavailable")
				}
				page.ObservedAt = obs.ObservedAt
				for _, account := range obs.Data.Items {
					item := Aggregate(account, code, false)
					if !matchAggregated(item, ListFilter{Verification: f.Verification}) {
						continue
					}
					if len(streams) > 1 {
						full, err := s.GetAccount(ctx, actor, account.AccountID)
						if err != nil {
							return page, err
						}
						owner := ""
						for _, conn := range full.Connections {
							domain := strings.ToLower(conn.AccountDomain)
							domainMatches := query.Domain == "" || domain == query.Domain
							if query.Subdomain != "" {
								domainMatches = domain == query.Subdomain || domain == query.Subdomain+".amocrm.ru" || domain == query.Subdomain+".kommo.com" || domain == query.Subdomain+".amocrm.test" || domain == query.Subdomain+".kommo.test"
							}
							if participating[conn.Backend] && (f.IntegrationID == "" || conn.IntegrationID == f.IntegrationID) && domainMatches && conn.AuthorizationCheck.Matches(f.Verification) && (owner == "" || conn.Backend < owner) {
								owner = conn.Backend
							}
						}
						if owner != code {
							continue
						}
						item = full.Aggregated
					}
					if !matchAggregated(item, f) {
						continue
					}
					page.Items = append(page.Items, positioned[Aggregated]{Value: item, At: account.LastActivityAt, Cursor: account.Cursor})
					if len(page.Items) > limit {
						page.More = true
						return page, nil
					}
				}
				if obs.Data.NextCursor == nil || *obs.Data.NextCursor == "" {
					if len(page.Items) == 0 {
						page.EmptyCursor = exhaustedVerificationStream
					}
					return page, nil
				}
				if *obs.Data.NextCursor == cursor {
					return page, adapter.Unavailable(code, "backend pagination did not advance")
				}
				cursor = *obs.Data.NextCursor
				page.More = true
				if len(page.Items) > 0 {
					return page, nil
				}
				page.EmptyCursor = cursor
			}
			return page, nil
		}})
	}
	scope, _ := json.Marshal([]string{"verification", f.Q, f.Product, f.Connection, f.Problem, f.Origin, f.Backend, f.IntegrationID, f.Verification})
	items, next, sources, err := mergePages(ctx, string(scope), f.Cursor, limit, streams, nil)
	if sourceUnavailable(sources) {
		for i := range items {
			items[i].State = adapter.AccountPartial
		}
	}
	return ListResult{Items: items, NextCursor: next, Sources: sources}, err
}
