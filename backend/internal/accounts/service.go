package accounts

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
)

type Service struct {
	backends []adapter.Backend
	audit    *audit.Store
}

type ListFilter struct {
	Q          string
	Product    string
	Connection string
	Problem    string
	Origin     string
	Backend    string
	Limit      int
	Cursor     string
}

type ListResult struct {
	Items      []Aggregated
	NextCursor *string
	Total      *int
	Sources    []adapter.SourceStatus
}

type AccountCard struct {
	Aggregated
	Sources []adapter.SourceStatus
}

type HistoryItem struct {
	Source       string    `json:"source"`
	Backend      string    `json:"backend,omitempty"`
	OccurredAt   time.Time `json:"occurred_at"`
	Action       string    `json:"action"`
	ActorType    *string   `json:"actor_type,omitempty"`
	ActorID      *string   `json:"actor_id,omitempty"`
	ActorEmail   *string   `json:"actor_email,omitempty"`
	ObjectType   *string   `json:"object_type,omitempty"`
	ObjectID     *string   `json:"object_id,omitempty"`
	ObjectRef    *string   `json:"object_ref,omitempty"`
	ConnectionID *string   `json:"connection_id,omitempty"`
	Outcome      *string   `json:"outcome,omitempty"`
	Metadata     []byte    `json:"-"`
}

type HistoryResult struct {
	Items      []HistoryItem
	NextCursor *string
	Sources    []adapter.SourceStatus
}

func New(backends []adapter.Backend, auditStore *audit.Store) *Service {
	return &Service{backends: backends, audit: auditStore}
}

const (
	scanPageSize    = 100
	maxScanAccounts = 1000
	scanCursor      = "scan:"
)

func hasPostFilter(f ListFilter) bool {
	return f.Product != "" || f.Connection != "" || f.Problem != "" || f.Origin != ""
}

func (s *Service) ListAccounts(ctx context.Context, actor adapter.Actor, filter ListFilter) (ListResult, error) {
	limit := filter.Limit
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}
	scanOffset := 0
	scanMode := strings.HasPrefix(filter.Cursor, scanCursor)
	if scanMode {
		parsed, err := strconv.Atoi(strings.TrimPrefix(filter.Cursor, scanCursor))
		if err != nil || parsed < 0 {
			return ListResult{}, adapter.ErrInvalidArgument
		}
		scanOffset = parsed
	}
	var cursors map[string]string
	if !scanMode {
		decoded, err := DecodeCursors(filter.Cursor)
		if err != nil {
			return ListResult{}, adapter.ErrInvalidArgument
		}
		cursors = decoded
	} else {
		cursors = map[string]string{}
	}
	query := NormalizeQuery(filter.Q)
	backends := s.accountBackends(filter.Backend)
	if hasPostFilter(filter) || scanMode {
		return s.scanAccounts(ctx, actor, filter, query, backends, scanOffset, limit)
	}
	gathered := adapter.Gather(ctx, backends, func(ctx context.Context, backend adapter.Backend) (adapter.Observation[adapter.Page[adapter.Account]], error) {
		return backend.ListAccounts(ctx, actor, adapter.AccountFilter{
			Query:  query.CoreQ(),
			Limit:  limit,
			Cursor: cursors[backend.Descriptor().Code],
		})
	})
	if gathered.Invalid != nil {
		return ListResult{}, adapter.ErrInvalidArgument
	}

	totalKnown := true
	total := 0
	unavailable := sourceUnavailable(gathered.Sources)
	merged := map[int64]*Aggregated{}
	order := make([]int64, 0)
	next := map[string]string{}
	for _, obs := range gathered.Items {
		backend := obs.Source
		if obs.Data == nil {
			totalKnown = false
			continue
		}
		if obs.Data.NextCursor != nil && *obs.Data.NextCursor != "" {
			next[backend] = *obs.Data.NextCursor
		}
		if obs.Data.Total == nil {
			totalKnown = false
		} else {
			total += *obs.Data.Total
		}
		for _, account := range obs.Data.Items {
			item := Aggregate(account, backend, unavailable)
			if existing, ok := merged[account.AccountID]; ok {
				existing.Connections = append(existing.Connections, item.Connections...)
				existing.Domains = uniqueStrings(append(existing.Domains, item.Domains...))
				if item.LastActivityAt.After(existing.LastActivityAt) {
					existing.LastActivityAt = item.LastActivityAt
				}
				reaggregated := AggregateConnections(existing.AccountID, existing.Domains, existing.LastActivityAt, existing.Connections, unavailable)
				*existing = reaggregated
				continue
			}
			copyItem := item
			merged[account.AccountID] = &copyItem
			order = append(order, account.AccountID)
		}
	}

	items := make([]Aggregated, 0, len(order))
	for _, id := range order {
		item := *merged[id]
		if matchAggregated(item, filter) {
			items = append(items, item)
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if !items[i].LastActivityAt.Equal(items[j].LastActivityAt) {
			return items[i].LastActivityAt.After(items[j].LastActivityAt)
		}
		return items[i].AccountID > items[j].AccountID
	})
	var totalPtr *int
	if totalKnown {
		totalPtr = &total
	}
	return ListResult{Items: items, NextCursor: EncodeCursors(next), Total: totalPtr, Sources: gathered.Sources}, nil
}

// scanAccounts walks backend pages while a post-filter is active so that
// filtering happens before pagination, and returns an exact total when the
// scan completed within maxScanAccounts. The returned cursor is an opaque
// offset that replays the same scan on the next page.
func (s *Service) scanAccounts(
	ctx context.Context,
	actor adapter.Actor,
	filter ListFilter,
	query Query,
	backends []adapter.Backend,
	offset, limit int,
) (ListResult, error) {
	pageCursors := map[string]string{}
	sources := []adapter.SourceStatus{}
	unavailable := false
	merged := map[int64]*Aggregated{}
	order := make([]int64, 0)
	complete := false
	for page := 0; page < maxScanAccounts/scanPageSize; page++ {
		gathered := adapter.Gather(ctx, backends, func(ctx context.Context, backend adapter.Backend) (adapter.Observation[adapter.Page[adapter.Account]], error) {
			return backend.ListAccounts(ctx, actor, adapter.AccountFilter{
				Query:  query.CoreQ(),
				Limit:  scanPageSize,
				Cursor: pageCursors[backend.Descriptor().Code],
			})
		})
		if gathered.Invalid != nil {
			return ListResult{}, adapter.ErrInvalidArgument
		}
		if page == 0 {
			sources = gathered.Sources
		} else {
			for _, source := range gathered.Sources {
				sources = upsertSource(sources, source)
			}
		}
		pageUnavailable := sourceUnavailable(gathered.Sources)
		if pageUnavailable {
			unavailable = true
		}
		more := false
		for _, obs := range gathered.Items {
			if obs.Data == nil {
				continue
			}
			for _, account := range obs.Data.Items {
				item := Aggregate(account, obs.Source, pageUnavailable)
				if existing, ok := merged[account.AccountID]; ok {
					existing.Connections = append(existing.Connections, item.Connections...)
					existing.Domains = uniqueStrings(append(existing.Domains, item.Domains...))
					if item.LastActivityAt.After(existing.LastActivityAt) {
						existing.LastActivityAt = item.LastActivityAt
					}
					reaggregated := AggregateConnections(existing.AccountID, existing.Domains, existing.LastActivityAt, existing.Connections, pageUnavailable)
					*existing = reaggregated
					continue
				}
				copyItem := item
				merged[account.AccountID] = &copyItem
				order = append(order, account.AccountID)
			}
			if obs.Data.NextCursor != nil && *obs.Data.NextCursor != "" {
				pageCursors[obs.Source] = *obs.Data.NextCursor
				more = true
			} else {
				delete(pageCursors, obs.Source)
			}
		}
		if !more {
			complete = true
			break
		}
		if len(merged) >= maxScanAccounts {
			break
		}
	}

	items := make([]Aggregated, 0, len(order))
	for _, id := range order {
		item := *merged[id]
		if matchAggregated(item, filter) {
			items = append(items, item)
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if !items[i].LastActivityAt.Equal(items[j].LastActivityAt) {
			return items[i].LastActivityAt.After(items[j].LastActivityAt)
		}
		return items[i].AccountID > items[j].AccountID
	})

	total := len(items)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	next := ""
	if end < total {
		next = scanCursor + strconv.Itoa(end)
	}
	var totalPtr *int
	if complete && !unavailable {
		totalPtr = &total
	}
	return ListResult{
		Items:      items[offset:end],
		NextCursor: optionalCursor(next),
		Total:      totalPtr,
		Sources:    sources,
	}, nil
}

func optionalCursor(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func (s *Service) GetAccount(ctx context.Context, actor adapter.Actor, accountID int64) (AccountCard, error) {
	backends := adapter.Capable(s.backends, func(c adapter.Capabilities) bool { return c.Accounts })
	gathered := adapter.Gather(ctx, backends, func(ctx context.Context, backend adapter.Backend) (adapter.Observation[adapter.Account], error) {
		return backend.GetAccount(ctx, actor, accountID)
	})
	if gathered.Invalid != nil {
		return AccountCard{}, adapter.ErrInvalidArgument
	}
	unavailable := sourceUnavailable(gathered.Sources)
	found := false
	var connections []Connection
	var domains []string
	var lastActivity time.Time
	origin := adapter.OriginReal
	for _, obs := range gathered.Items {
		if obs.Data == nil {
			continue
		}
		found = true
		item := Aggregate(*obs.Data, obs.Source, unavailable)
		for i := range item.Connections {
			item.Connections[i].ObservedAt = obs.ObservedAt
			item.Connections[i].Freshness = obs.Freshness
		}
		connections = append(connections, item.Connections...)
		domains = append(domains, item.Domains...)
		if item.LastActivityAt.After(lastActivity) {
			lastActivity = item.LastActivityAt
		}
		if item.Origin == adapter.OriginFixture {
			origin = adapter.OriginFixture
		}
	}
	if !found && !unavailable {
		return AccountCard{}, adapter.ErrNotFound
	}
	aggregated := AggregateConnections(accountID, domains, lastActivity, connections, unavailable)
	if origin == adapter.OriginFixture {
		aggregated.Origin = origin
	}
	return AccountCard{Aggregated: aggregated, Sources: gathered.Sources}, nil
}

func (s *Service) History(ctx context.Context, actor adapter.Actor, accountID int64, limit int, cursor string) (HistoryResult, error) {
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}
	card, err := s.GetAccount(ctx, actor, accountID)
	if err != nil && !errors.Is(err, adapter.ErrNotFound) {
		return HistoryResult{}, err
	}
	if errors.Is(err, adapter.ErrNotFound) {
		return HistoryResult{}, adapter.ErrNotFound
	}

	items := make([]HistoryItem, 0)
	sources := append([]adapter.SourceStatus{}, card.Sources...)
	for _, conn := range card.Connections {
		backend, ok := s.backend(conn.Backend)
		if !ok || !backend.Capabilities().Audit {
			continue
		}
		obs, listErr := backend.ListConnectionAudit(ctx, actor, conn.ConnectionID, adapter.PageFilter{Limit: limit})
		if listErr != nil {
			sources = upsertSource(sources, adapter.SourceFromErr(conn.Backend, time.Now().UTC(), listErr))
			continue
		}
		if obs.Data == nil {
			continue
		}
		for _, entry := range obs.Data.Items {
			connID := conn.ConnectionID
			items = append(items, HistoryItem{
				Source:       conn.Backend,
				Backend:      conn.Backend,
				OccurredAt:   entry.CreatedAt,
				Action:       entry.Action,
				ActorType:    strPtr(entry.ActorType),
				ActorID:      entry.ActorID,
				ObjectType:   entry.ObjectType,
				ObjectID:     entry.ObjectID,
				ConnectionID: &connID,
				Metadata:     entry.Metadata,
			})
		}
	}

	if s.audit != nil {
		refs := []string{"account:" + strconv.FormatInt(accountID, 10)}
		for _, conn := range card.Connections {
			refs = append(refs, "connection:"+conn.Backend+":"+conn.ConnectionID)
		}
		adminItems, _, _, adminErr := s.audit.List(ctx, audit.ListFilter{ObjectRefs: refs, Limit: limit})
		if adminErr == nil {
			for _, entry := range adminItems {
				items = append(items, HistoryItem{
					Source:     "admin",
					OccurredAt: entry.CreatedAt,
					Action:     entry.Action,
					ActorEmail: entry.ActorEmail,
					ObjectType: entry.ObjectType,
					ObjectRef:  entry.ObjectRef,
					Outcome:    strPtr(entry.Outcome),
					Metadata:   entry.Metadata,
				})
			}
		}
	}

	sort.SliceStable(items, func(i, j int) bool {
		if !items[i].OccurredAt.Equal(items[j].OccurredAt) {
			return items[i].OccurredAt.After(items[j].OccurredAt)
		}
		return items[i].Action > items[j].Action
	})
	if cursor != "" {
		filtered := items[:0]
		skip := true
		for _, item := range items {
			key := historyKey(item)
			if skip {
				if key == cursor {
					skip = false
				}
				continue
			}
			filtered = append(filtered, item)
		}
		if skip {
			return HistoryResult{}, adapter.ErrInvalidArgument
		}
		items = filtered
	}
	var next *string
	if len(items) > limit {
		key := historyKey(items[limit-1])
		next = &key
		items = items[:limit]
	}
	return HistoryResult{Items: items, NextCursor: next, Sources: sources}, nil
}

func (s *Service) accountBackends(code string) []adapter.Backend {
	backends := adapter.Capable(s.backends, func(c adapter.Capabilities) bool { return c.Accounts })
	if strings.TrimSpace(code) == "" {
		return backends
	}
	for _, backend := range backends {
		if backend.Descriptor().Code == code {
			return []adapter.Backend{backend}
		}
	}
	return nil
}

func (s *Service) backend(code string) (adapter.Backend, bool) {
	for _, backend := range s.backends {
		if backend.Descriptor().Code == code {
			return backend, true
		}
	}
	return nil, false
}

func matchAggregated(item Aggregated, filter ListFilter) bool {
	if filter.Connection != "" {
		found := false
		for _, conn := range item.Connections {
			if conn.State.Canonical == filter.Connection {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if filter.Problem != "" {
		found := false
		for _, problem := range item.Problems {
			if problem == filter.Problem {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if filter.Origin != "" && item.Origin != filter.Origin {
		return false
	}
	if filter.Product != "" {
		found := false
		for _, conn := range item.Connections {
			if conn.IntegrationCode == filter.Product {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func sourceUnavailable(sources []adapter.SourceStatus) bool {
	for _, source := range sources {
		if source.Status == adapter.SourceUnavailable {
			return true
		}
	}
	return false
}

func upsertSource(sources []adapter.SourceStatus, next adapter.SourceStatus) []adapter.SourceStatus {
	for i, source := range sources {
		if source.Backend == next.Backend {
			sources[i] = next
			return sources
		}
	}
	return append(sources, next)
}

func historyKey(item HistoryItem) string {
	return item.OccurredAt.UTC().Format(time.RFC3339Nano) + "|" + item.Source + "|" + item.Action
}

func strPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
