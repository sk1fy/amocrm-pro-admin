package accounts

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
)

func (s *Service) History(ctx context.Context, actor adapter.Actor, accountID int64, limit int, cursor string) (HistoryResult, error) {
	card, err := s.GetAccount(ctx, actor, accountID)
	if err != nil {
		return HistoryResult{}, err
	}
	streams := []pageStream[HistoryItem]{}
	for _, conn := range card.Connections {
		backend, ok := s.backend(conn.Backend)
		if !ok || !backend.Capabilities().Audit {
			continue
		}
		streams = append(streams, pageStream[HistoryItem]{
			ID: "connection:" + conn.Backend + ":" + conn.ConnectionID, Backend: conn.Backend, Timeout: backend.Descriptor().Timeout,
			Read: func(ctx context.Context, limit int, cursor string) (streamPage[HistoryItem], error) {
				obs, err := backend.ListConnectionAudit(ctx, actor, conn.ConnectionID, adapter.PageFilter{Limit: limit, Cursor: cursor})
				if err != nil {
					return streamPage[HistoryItem]{}, err
				}
				if obs.Data == nil {
					return streamPage[HistoryItem]{}, adapter.Unavailable(conn.Backend, "audit data unavailable")
				}
				page := streamPage[HistoryItem]{More: obs.Data.NextCursor != nil, ObservedAt: obs.ObservedAt}
				for _, entry := range obs.Data.Items {
					connID := conn.ConnectionID
					page.Items = append(page.Items, positioned[HistoryItem]{At: entry.CreatedAt, Cursor: entry.Cursor, Value: HistoryItem{
						Source: conn.Backend, Backend: conn.Backend, OccurredAt: entry.CreatedAt, Action: entry.Action,
						ActorType: strPtr(entry.ActorType), ActorID: entry.ActorID, ObjectType: entry.ObjectType, ObjectID: entry.ObjectID,
						ConnectionID: &connID, Metadata: entry.Metadata,
					}})
				}
				return page, nil
			},
		})
	}
	if s.audit != nil {
		refs := []string{"account:" + strconv.FormatInt(accountID, 10)}
		for _, conn := range card.Connections {
			refs = append(refs, "connection:"+conn.Backend+":"+conn.ConnectionID)
		}
		streams = append(streams, pageStream[HistoryItem]{ID: "admin", Backend: "admin", Read: func(ctx context.Context, limit int, cursor string) (streamPage[HistoryItem], error) {
			entries, next, _, err := s.audit.List(ctx, audit.ListFilter{ObjectRefs: refs, Limit: limit, Cursor: cursor})
			if errors.Is(err, audit.ErrInvalidCursor) {
				return streamPage[HistoryItem]{}, adapter.ErrInvalidArgument
			}
			if err != nil {
				return streamPage[HistoryItem]{}, err
			}
			page := streamPage[HistoryItem]{More: next != nil, ObservedAt: time.Now().UTC()}
			for _, entry := range entries {
				page.Items = append(page.Items, positioned[HistoryItem]{At: entry.CreatedAt, Cursor: audit.EntryCursor(entry), Value: HistoryItem{
					Source: "admin", OccurredAt: entry.CreatedAt, Action: entry.Action, ActorEmail: entry.ActorEmail,
					ObjectType: entry.ObjectType, ObjectRef: entry.ObjectRef, Outcome: strPtr(entry.Outcome), Metadata: entry.Metadata,
				}})
			}
			return page, nil
		}})
	}
	items, next, sources, err := mergePages(ctx, "history:"+strconv.FormatInt(accountID, 10), cursor, limit, streams, card.Sources)
	return HistoryResult{Items: items, NextCursor: next, Sources: sources}, err
}
