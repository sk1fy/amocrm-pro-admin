package accounts

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

type AccountJob struct {
	Backend string
	Job     adapter.Job
}
type JobsResult struct {
	Items      []AccountJob
	NextCursor *string
	Sources    []adapter.SourceStatus
}

func (s *Service) Jobs(ctx context.Context, actor adapter.Actor, accountID int64, filter adapter.JobFilter) (JobsResult, error) {
	card, err := s.GetAccount(ctx, actor, accountID)
	if err != nil {
		return JobsResult{}, err
	}
	streams := []pageStream[AccountJob]{}
	for _, conn := range card.Connections {
		backend, ok := s.backend(conn.Backend)
		if !ok || !backend.Capabilities().Jobs {
			continue
		}
		streams = append(streams, pageStream[AccountJob]{ID: conn.Backend + ":" + conn.ConnectionID, Backend: conn.Backend, Timeout: backend.Descriptor().Timeout,
			Read: func(ctx context.Context, limit int, cursor string) (streamPage[AccountJob], error) {
				f := filter
				f.Limit = limit
				f.Cursor = cursor
				obs, err := backend.ListConnectionJobs(ctx, actor, conn.ConnectionID, f)
				if err != nil {
					return streamPage[AccountJob]{}, err
				}
				if obs.Data == nil {
					return streamPage[AccountJob]{}, adapter.Unavailable(conn.Backend, "jobs data unavailable")
				}
				page := streamPage[AccountJob]{More: obs.Data.NextCursor != nil, ObservedAt: obs.ObservedAt}
				for _, job := range obs.Data.Items {
					page.Items = append(page.Items, positioned[AccountJob]{At: job.UpdatedAt, Cursor: job.Cursor, Value: AccountJob{Backend: conn.Backend, Job: job}})
				}
				return page, nil
			},
		})
	}
	scope, _ := json.Marshal([]string{"jobs", strconv.FormatInt(accountID, 10), filter.Status, filter.Type})
	items, next, sources, err := mergePages(ctx, string(scope), filter.Cursor, filter.Limit, streams, card.Sources)
	return JobsResult{Items: items, NextCursor: next, Sources: sources}, err
}
