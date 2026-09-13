package fixture

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

type Data struct {
	Accounts          []adapter.Account
	ConnectionDetails map[string]adapter.ConnectionDetail
	Integrations      []adapter.Integration
	Jobs              []adapter.JobDetail
	ConnectionJobs    map[string][]adapter.Job
	ConnectionAudit   map[string][]adapter.AuditEntry
	Deliveries        map[string][]adapter.Delivery
	ActivitySettings  map[string]adapter.ActivitySettings
	ActivitySync      map[string]adapter.ActivitySyncStatus
	ActivityPanels    map[string][]adapter.ActivityPanel
	ActivityEmployees map[string][]adapter.ActivityEmployee
	LeadStatusRules   map[string][]adapter.LeadStatusRule
	LeadStatusRuns    map[string][]adapter.LeadStatusRun
	Stats             map[string]adapter.StatsSnapshot
	StatsAccounts     map[string][]adapter.StatsAccount
	Subscriptions     map[int64]adapter.Subscription
	Health            adapter.Health
}

type Adapter struct {
	mu        sync.RWMutex
	commandMu sync.Mutex
	commands  map[string]commandReceipt
	desc      adapter.Descriptor
	caps      adapter.Capabilities
	err       error
	data      Data
}

type Options struct {
	Code    string
	Timeout time.Duration
	Err     error
	Data    Data
	Caps    *adapter.Capabilities
}

func New(opts Options) *Adapter {
	code := strings.TrimSpace(opts.Code)
	if code == "" {
		code = adapter.KindFixture
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	caps := adapter.Capabilities{
		Accounts: true, Connections: true, Integrations: true, Jobs: true, Audit: true, Commands: true, Diagnostics: true,
		ActivityDeliveries: true, Settings: true, Stats: true, Subscriptions: true,
	}
	if opts.Caps != nil {
		caps = *opts.Caps
	}
	health := opts.Data.Health
	if health.Backend == "" {
		health.Backend = code
	}
	if health.ContractVersion == "" {
		health.ContractVersion = adapter.ContractVersion
	}
	if health.Revision == "" {
		health.Revision = "fixture"
	}
	if health.Capabilities == nil {
		health.Capabilities = []string{"accounts", "connections", "integrations", "jobs", "audit"}
	}
	data := opts.Data
	data.Health = health
	if data.ConnectionDetails == nil {
		data.ConnectionDetails = map[string]adapter.ConnectionDetail{}
	}
	if data.ConnectionJobs == nil {
		data.ConnectionJobs = map[string][]adapter.Job{}
	}
	if data.ConnectionAudit == nil {
		data.ConnectionAudit = map[string][]adapter.AuditEntry{}
	}
	if data.Deliveries == nil {
		data.Deliveries = map[string][]adapter.Delivery{}
	}
	if data.ActivitySettings == nil {
		data.ActivitySettings = map[string]adapter.ActivitySettings{}
	}
	if data.ActivitySync == nil {
		data.ActivitySync = map[string]adapter.ActivitySyncStatus{}
	}
	if data.ActivityPanels == nil {
		data.ActivityPanels = map[string][]adapter.ActivityPanel{}
	}
	if data.ActivityEmployees == nil {
		data.ActivityEmployees = map[string][]adapter.ActivityEmployee{}
	}
	if data.LeadStatusRules == nil {
		data.LeadStatusRules = map[string][]adapter.LeadStatusRule{}
	}
	if data.LeadStatusRuns == nil {
		data.LeadStatusRuns = map[string][]adapter.LeadStatusRun{}
	}
	if data.Stats == nil {
		data.Stats = map[string]adapter.StatsSnapshot{}
	}
	if data.StatsAccounts == nil {
		data.StatsAccounts = map[string][]adapter.StatsAccount{}
	}
	if data.Subscriptions == nil {
		data.Subscriptions = map[int64]adapter.Subscription{}
	}
	return &Adapter{
		desc: adapter.Descriptor{
			Code: code, Kind: adapter.KindFixture,
			ContractVersion: adapter.ContractVersion, Timeout: timeout,
		},
		caps: caps,
		err:  opts.Err,
		data: data,
	}
}

func Unavailable(code string) *Adapter {
	return New(Options{Code: code, Err: adapter.Unavailable(code, "backend unavailable")})
}

func (a *Adapter) Descriptor() adapter.Descriptor     { return a.desc }
func (a *Adapter) Capabilities() adapter.Capabilities { return a.caps }

func (a *Adapter) Health(ctx context.Context, _ adapter.Actor) (adapter.Observation[adapter.Health], error) {
	data := a.snapshot()
	if err := a.check(ctx); err != nil {
		return adapter.Observation[adapter.Health]{}, err
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), data.Health), nil
}

func (a *Adapter) ListAccounts(ctx context.Context, _ adapter.Actor, f adapter.AccountFilter) (adapter.Observation[adapter.Page[adapter.Account]], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.Accounts); err != nil {
		return adapter.Observation[adapter.Page[adapter.Account]]{}, err
	}
	items := make([]adapter.Account, 0, len(data.Accounts))
	for _, account := range data.Accounts {
		if matchAccount(account, f) {
			items = append(items, account)
		}
	}
	page, err := paginate(items, f.Limit, f.Cursor, func(item adapter.Account) string {
		return strconv.FormatInt(item.AccountID, 10)
	})
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.Account]]{}, adapter.InvalidArgument(a.desc.Code, "invalid cursor")
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), page), nil
}

func (a *Adapter) GetAccount(ctx context.Context, _ adapter.Actor, accountID int64) (adapter.Observation[adapter.Account], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.Accounts); err != nil {
		return adapter.Observation[adapter.Account]{}, err
	}
	for _, account := range data.Accounts {
		if account.AccountID == accountID {
			return adapter.Fresh(a.desc.Code, time.Now().UTC(), account), nil
		}
	}
	return adapter.Observation[adapter.Account]{}, adapter.NotFound(a.desc.Code, "account not found")
}

func (a *Adapter) ListConnections(ctx context.Context, _ adapter.Actor, f adapter.ConnectionFilter) (adapter.Observation[adapter.Page[adapter.ConnectionSummary]], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.Connections); err != nil {
		return adapter.Observation[adapter.Page[adapter.ConnectionSummary]]{}, err
	}
	items := make([]adapter.ConnectionSummary, 0)
	for _, account := range data.Accounts {
		for _, conn := range account.Connections {
			if conn.AccountID == 0 {
				conn.AccountID = account.AccountID
			}
			if matchConnection(conn, f) {
				items = append(items, conn)
			}
		}
	}
	for id, detail := range data.ConnectionDetails {
		conn := detail.Connection
		if conn.ID == "" {
			conn.ID = id
		}
		if matchConnection(conn, f) && !containsConnection(items, conn.ID) {
			items = append(items, conn)
		}
	}
	page, err := paginate(items, f.Limit, f.Cursor, func(item adapter.ConnectionSummary) string { return item.ID })
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.ConnectionSummary]]{}, adapter.InvalidArgument(a.desc.Code, "invalid cursor")
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), page), nil
}

func (a *Adapter) GetConnection(ctx context.Context, _ adapter.Actor, id string) (adapter.Observation[adapter.ConnectionDetail], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.Connections); err != nil {
		return adapter.Observation[adapter.ConnectionDetail]{}, err
	}
	if detail, ok := data.ConnectionDetails[id]; ok {
		if detail.Connection.ID == "" {
			detail.Connection.ID = id
		}
		return adapter.Fresh(a.desc.Code, time.Now().UTC(), detail), nil
	}
	for _, account := range data.Accounts {
		for _, conn := range account.Connections {
			if conn.ID == id {
				return adapter.Fresh(a.desc.Code, time.Now().UTC(), adapter.ConnectionDetail{Connection: conn}), nil
			}
		}
	}
	return adapter.Observation[adapter.ConnectionDetail]{}, adapter.NotFound(a.desc.Code, "connection not found")
}

func (a *Adapter) ListConnectionJobs(ctx context.Context, _ adapter.Actor, id string, f adapter.JobFilter) (adapter.Observation[adapter.Page[adapter.Job]], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.Jobs); err != nil {
		return adapter.Observation[adapter.Page[adapter.Job]]{}, err
	}
	if _, err := a.GetConnection(ctx, adapter.Actor{}, id); err != nil {
		return adapter.Observation[adapter.Page[adapter.Job]]{}, err
	}
	items := append([]adapter.Job{}, data.ConnectionJobs[id]...)
	items = filterJobs(items, f)
	page, err := paginate(items, f.Limit, f.Cursor, func(item adapter.Job) string { return item.ID })
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.Job]]{}, adapter.InvalidArgument(a.desc.Code, "invalid cursor")
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), page), nil
}

func (a *Adapter) ListConnectionAudit(ctx context.Context, _ adapter.Actor, id string, f adapter.PageFilter) (adapter.Observation[adapter.Page[adapter.AuditEntry]], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.Audit); err != nil {
		return adapter.Observation[adapter.Page[adapter.AuditEntry]]{}, err
	}
	if _, err := a.GetConnection(ctx, adapter.Actor{}, id); err != nil {
		return adapter.Observation[adapter.Page[adapter.AuditEntry]]{}, err
	}
	items := append([]adapter.AuditEntry{}, data.ConnectionAudit[id]...)
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].CreatedAt.After(items[j].CreatedAt)
		}
		return items[i].ID > items[j].ID
	})
	for i := range items {
		items[i].Cursor = strconv.FormatInt(items[i].ID, 10)
	}
	page, err := paginate(items, f.Limit, f.Cursor, func(item adapter.AuditEntry) string {
		return strconv.FormatInt(item.ID, 10)
	})
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.AuditEntry]]{}, adapter.InvalidArgument(a.desc.Code, "invalid cursor")
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), page), nil
}

func (a *Adapter) ListConnectionDeliveries(ctx context.Context, _ adapter.Actor, id string, _ adapter.PageFilter) (adapter.Observation[[]adapter.Delivery], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.ActivityDeliveries); err != nil {
		return adapter.Observation[[]adapter.Delivery]{}, err
	}
	if _, err := a.GetConnection(ctx, adapter.Actor{}, id); err != nil {
		return adapter.Observation[[]adapter.Delivery]{}, err
	}
	items := append([]adapter.Delivery{}, data.Deliveries[id]...)
	if items == nil {
		items = []adapter.Delivery{}
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), items), nil
}

func (a *Adapter) ListIntegrations(ctx context.Context, _ adapter.Actor, f adapter.PageFilter) (adapter.Observation[adapter.Page[adapter.Integration]], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.Integrations); err != nil {
		return adapter.Observation[adapter.Page[adapter.Integration]]{}, err
	}
	page, err := paginate(data.Integrations, f.Limit, f.Cursor, func(item adapter.Integration) string { return item.ID })
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.Integration]]{}, adapter.InvalidArgument(a.desc.Code, "invalid cursor")
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), page), nil
}

func (a *Adapter) GetIntegration(ctx context.Context, _ adapter.Actor, id string) (adapter.Observation[adapter.Integration], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.Integrations); err != nil {
		return adapter.Observation[adapter.Integration]{}, err
	}
	for _, item := range data.Integrations {
		if item.ID == id {
			return adapter.Fresh(a.desc.Code, time.Now().UTC(), item), nil
		}
	}
	return adapter.Observation[adapter.Integration]{}, adapter.NotFound(a.desc.Code, "integration not found")
}

func (a *Adapter) ListJobs(ctx context.Context, _ adapter.Actor, f adapter.JobFilter) (adapter.Observation[adapter.Page[adapter.Job]], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.Jobs); err != nil {
		return adapter.Observation[adapter.Page[adapter.Job]]{}, err
	}
	items := make([]adapter.Job, 0, len(data.Jobs))
	seen := map[string]struct{}{}
	add := func(item adapter.Job) {
		if item.ID != "" {
			if _, ok := seen[item.ID]; ok {
				return
			}
			seen[item.ID] = struct{}{}
		}
		items = append(items, item)
	}
	for _, detail := range data.Jobs {
		add(detail.Job)
	}
	for _, jobs := range data.ConnectionJobs {
		for _, job := range jobs {
			add(job)
		}
	}
	items = filterJobs(items, f)
	page, err := paginate(items, f.Limit, f.Cursor, func(item adapter.Job) string { return item.ID })
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.Job]]{}, adapter.InvalidArgument(a.desc.Code, "invalid cursor")
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), page), nil
}

func (a *Adapter) GetJob(ctx context.Context, _ adapter.Actor, id string) (adapter.Observation[adapter.JobDetail], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.Jobs); err != nil {
		return adapter.Observation[adapter.JobDetail]{}, err
	}
	for _, item := range data.Jobs {
		if item.Job.ID == id {
			return adapter.Fresh(a.desc.Code, time.Now().UTC(), item), nil
		}
	}
	for _, jobs := range data.ConnectionJobs {
		for _, job := range jobs {
			if job.ID == id {
				return adapter.Fresh(a.desc.Code, time.Now().UTC(), adapter.JobDetail{Job: job}), nil
			}
		}
	}
	return adapter.Observation[adapter.JobDetail]{}, adapter.NotFound(a.desc.Code, "job not found")
}

func (a *Adapter) JobsSummary(ctx context.Context, _ adapter.Actor) (adapter.Observation[adapter.JobsSummary], error) {
	data := a.snapshot()
	if err := a.require(ctx, a.caps.Jobs); err != nil {
		return adapter.Observation[adapter.JobsSummary]{}, err
	}
	counts := map[string]int{}
	for _, detail := range data.Jobs {
		if detail.Job.Status.Canonical != "" {
			counts[detail.Job.Status.Canonical]++
		}
	}
	return adapter.Fresh(a.desc.Code, time.Now().UTC(), adapter.JobsSummary{Counts: counts}), nil
}

func (a *Adapter) require(ctx context.Context, capable bool) error {
	if err := a.check(ctx); err != nil {
		return err
	}
	if !capable {
		return adapter.Unsupported(a.desc.Code, "capability is not declared")
	}
	return nil
}

func (a *Adapter) check(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return adapter.Timeout(a.desc.Code, "backend timed out")
	}
	return a.err
}

func matchAccount(account adapter.Account, f adapter.AccountFilter) bool {
	if f.Query != "" {
		q := strings.ToLower(strings.TrimSpace(f.Query))
		id := strconv.FormatInt(account.AccountID, 10)
		matched := id == q
		for _, domain := range account.Domains {
			lower := strings.ToLower(domain)
			if lower == q || strings.HasPrefix(lower, q+".") || strings.Split(lower, ".")[0] == q {
				matched = true
			}
		}
		if !matched {
			return false
		}
	}
	if f.IntegrationID != "" || f.Status != "" {
		found := false
		for _, conn := range account.Connections {
			if f.IntegrationID != "" && conn.IntegrationID != f.IntegrationID {
				continue
			}
			if f.Status != "" && conn.Status.Canonical != f.Status {
				continue
			}
			found = true
			break
		}
		if !found {
			return false
		}
	}
	return true
}

func matchConnection(conn adapter.ConnectionSummary, f adapter.ConnectionFilter) bool {
	if f.AccountID != nil && conn.AccountID != *f.AccountID {
		return false
	}
	if f.Domain != "" && !strings.EqualFold(conn.AccountDomain, f.Domain) {
		return false
	}
	if f.IntegrationID != "" && conn.IntegrationID != f.IntegrationID {
		return false
	}
	if f.Status != "" && conn.Status.Canonical != f.Status {
		return false
	}
	if f.WebhookStatus != "" && conn.WebhookStatus.Canonical != f.WebhookStatus {
		return false
	}
	return true
}

func containsConnection(items []adapter.ConnectionSummary, id string) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}

func filterJobs(items []adapter.Job, f adapter.JobFilter) []adapter.Job {
	out := make([]adapter.Job, 0, len(items))
	for _, item := range items {
		if f.Status != "" && item.Status.Canonical != f.Status {
			continue
		}
		if f.Type != "" && item.Type != f.Type {
			continue
		}
		if f.Since != nil && item.CreatedAt.Before(*f.Since) {
			continue
		}
		item.Cursor = item.ID
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].UpdatedAt.Equal(out[j].UpdatedAt) {
			return out[i].UpdatedAt.After(out[j].UpdatedAt)
		}
		return out[i].ID > out[j].ID
	})
	return out
}

func paginate[T any](items []T, limit int, cursor string, id func(T) string) (adapter.Page[T], error) {
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}
	start := 0
	if cursor != "" {
		found := false
		for i, item := range items {
			if id(item) == cursor {
				start = i + 1
				found = true
				break
			}
		}
		if !found {
			return adapter.Page[T]{}, adapter.ErrInvalidArgument
		}
	}
	total := len(items)
	if start > len(items) {
		start = len(items)
	}
	end := start + limit
	var next *string
	if end < len(items) {
		value := id(items[end-1])
		next = &value
	} else {
		end = len(items)
	}
	page := items[start:end]
	if page == nil {
		page = []T{}
	}
	return adapter.Page[T]{Items: page, NextCursor: next, Total: &total}, nil
}
