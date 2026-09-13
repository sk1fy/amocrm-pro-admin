package accounts

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"golang.org/x/sync/errgroup"
)

type mergeCursor struct {
	Version   int               `json:"v"`
	Scope     string            `json:"scope"`
	Positions map[string]string `json:"positions"`
}

type positioned[T any] struct {
	Value  T
	At     time.Time
	Cursor string
}

type streamPage[T any] struct {
	Items      []positioned[T]
	More       bool
	ObservedAt time.Time
}

type pageStream[T any] struct {
	ID      string
	Backend string
	Timeout time.Duration
	Read    func(context.Context, int, string) (streamPage[T], error)
}

// mergePages reads one bounded page per stream. Every emitted row carries its
// native keyset cursor, so an unconsumed suffix is fetched again without offsets
// or embedding audit/job data in the public continuation cursor.
func mergePages[T any](ctx context.Context, scope, raw string, limit int, streams []pageStream[T], sources []adapter.SourceStatus) ([]T, *string, []adapter.SourceStatus, error) {
	limit = pageLimit(limit)
	cursor := mergeCursor{Version: 1, Scope: scope, Positions: map[string]string{}}
	if raw != "" {
		if len(raw) > 64*1024 {
			return nil, nil, nil, adapter.ErrInvalidArgument
		}
		data, err := base64.RawURLEncoding.DecodeString(raw)
		var decoded mergeCursor
		if err != nil || json.Unmarshal(data, &decoded) != nil || decoded.Version != 1 || decoded.Scope != scope || decoded.Positions == nil {
			return nil, nil, nil, adapter.ErrInvalidArgument
		}
		cursor = decoded
	}
	type result struct {
		page streamPage[T]
		err  error
	}
	results := make([]result, len(streams))
	var group errgroup.Group
	for i, stream := range streams {
		group.Go(func() error {
			timeout := stream.Timeout
			if timeout <= 0 {
				timeout = 5 * time.Second
			}
			callCtx, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()
			results[i].page, results[i].err = stream.Read(callCtx, limit, cursor.Positions[stream.ID])
			return nil
		})
	}
	_ = group.Wait()
	type candidate struct {
		row    positioned[T]
		stream int
	}
	candidates := []candidate{}
	more := sourceUnavailable(sources)
	for i, result := range results {
		if errors.Is(result.err, adapter.ErrInvalidArgument) {
			return nil, nil, nil, adapter.ErrInvalidArgument
		}
		observed := result.page.ObservedAt
		if observed.IsZero() {
			observed = time.Now().UTC()
		}
		status := adapter.SourceFromErr(streams[i].Backend, observed, result.err)
		sources = mergeSource(sources, status)
		if result.err != nil {
			more = true
			continue
		}
		more = more || result.page.More
		for _, row := range result.page.Items {
			if row.Cursor == "" {
				return nil, nil, nil, adapter.Unavailable(streams[i].Backend, "missing row continuation")
			}
			candidates = append(candidates, candidate{row: row, stream: i})
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		if !a.row.At.Equal(b.row.At) {
			return a.row.At.After(b.row.At)
		}
		// Preserve native order within a source, including equal timestamps and IDs.
		return streams[a.stream].ID < streams[b.stream].ID
	})
	if len(candidates) > limit {
		more = true
		candidates = candidates[:limit]
	}
	items := make([]T, 0, len(candidates))
	for _, item := range candidates {
		items = append(items, item.row.Value)
		cursor.Positions[streams[item.stream].ID] = item.row.Cursor
	}
	var next *string
	if more && len(items) > 0 {
		data, err := json.Marshal(cursor)
		if err != nil {
			return nil, nil, nil, err
		}
		encoded := base64.RawURLEncoding.EncodeToString(data)
		next = &encoded
	}
	return items, next, sources, nil
}

func mergeSource(sources []adapter.SourceStatus, status adapter.SourceStatus) []adapter.SourceStatus {
	for i, current := range sources {
		if current.Backend != status.Backend {
			continue
		}
		if current.Status != adapter.SourceUnavailable {
			sources[i] = status
		}
		return sources
	}
	return append(sources, status)
}

func pageLimit(limit int) int {
	if limit <= 0 {
		return 25
	}
	if limit > 100 {
		return 100
	}
	return limit
}
