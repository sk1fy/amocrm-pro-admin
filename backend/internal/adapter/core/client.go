package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

const maxResponseBytes = 8 << 20

type Client struct {
	desc       adapter.Descriptor
	baseURL    *url.URL
	token      string
	healthPath string
	httpClient *http.Client
}

type Options struct {
	Code       string
	BaseURL    string
	Token      string
	Timeout    time.Duration
	HealthPath string
	HTTPClient *http.Client
}

func New(opts Options) (*Client, error) {
	code := strings.TrimSpace(opts.Code)
	if code == "" {
		code = "core"
	}
	if strings.TrimSpace(opts.Token) == "" {
		return nil, fmt.Errorf("core adapter %s: token is required", code)
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	parsed, err := url.Parse(strings.TrimSpace(opts.BaseURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("core adapter %s: base_url must be an absolute URL", code)
	}
	healthPath := strings.TrimSpace(opts.HealthPath)
	if healthPath == "" {
		healthPath = "/admin/v1/backend"
	}
	httpClient := opts.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{
			Timeout: timeout,
			Transport: &http.Transport{
				Proxy:                 http.ProxyFromEnvironment,
				DialContext:           (&net.Dialer{Timeout: timeout}).DialContext,
				ResponseHeaderTimeout: timeout,
			},
		}
	}
	return &Client{
		desc: adapter.Descriptor{
			Code: code, Kind: adapter.KindCoreHTTP,
			ContractVersion: adapter.ContractVersion, Timeout: timeout,
		},
		baseURL:    parsed,
		token:      opts.Token,
		healthPath: healthPath,
		httpClient: httpClient,
	}, nil
}

func (c *Client) Descriptor() adapter.Descriptor { return c.desc }

func (c *Client) Capabilities() adapter.Capabilities {
	return adapter.Capabilities{
		Accounts: true, Connections: true, Integrations: true, Jobs: true, Audit: true,
		ActivityDeliveries: true,
	}
}

func (c *Client) Health(ctx context.Context, actor adapter.Actor) (adapter.Observation[adapter.Health], error) {
	var resp healthResponse
	if err := c.get(ctx, actor, c.healthPath, nil, &resp); err != nil {
		return adapter.Observation[adapter.Health]{}, err
	}
	var components any
	if len(resp.Components) > 0 {
		if err := json.Unmarshal(resp.Components, &components); err != nil {
			components = nil
		}
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, adapter.Health{
		Backend:         resp.Backend,
		Revision:        resp.Revision,
		ContractVersion: resp.ContractVersion,
		Capabilities:    resp.Capabilities,
		Components:      components,
	}), nil
}

func (c *Client) ListAccounts(ctx context.Context, actor adapter.Actor, f adapter.AccountFilter) (adapter.Observation[adapter.Page[adapter.Account]], error) {
	query := url.Values{}
	setQuery(query, "q", f.Query)
	setQuery(query, "integration_id", f.IntegrationID)
	setQuery(query, "status", f.Status)
	setLimitCursor(query, f.Limit, f.Cursor)
	var envelope listEnvelope
	if err := c.get(ctx, actor, "/admin/v1/accounts", query, &envelope); err != nil {
		return adapter.Observation[adapter.Page[adapter.Account]]{}, err
	}
	raw, err := decodeList[accountListItem](envelope.Items)
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.Account]]{}, adapter.Unavailable(c.desc.Code, "core returned invalid json")
	}
	items := make([]adapter.Account, 0, len(raw))
	for _, item := range raw {
		items = append(items, mapAccountListItem(item))
	}
	return adapter.Fresh(c.desc.Code, envelope.ObservedAt, adapter.Page[adapter.Account]{
		Items: items, NextCursor: envelope.NextCursor, Total: envelope.Total,
	}), nil
}

func (c *Client) GetAccount(ctx context.Context, actor adapter.Actor, accountID int64) (adapter.Observation[adapter.Account], error) {
	var resp accountResponse
	path := "/admin/v1/accounts/" + strconv.FormatInt(accountID, 10)
	if err := c.get(ctx, actor, path, nil, &resp); err != nil {
		return adapter.Observation[adapter.Account]{}, err
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, mapAccount(resp)), nil
}

func (c *Client) ListConnections(ctx context.Context, actor adapter.Actor, f adapter.ConnectionFilter) (adapter.Observation[adapter.Page[adapter.ConnectionSummary]], error) {
	query := url.Values{}
	if f.AccountID != nil {
		query.Set("account_id", strconv.FormatInt(*f.AccountID, 10))
	}
	setQuery(query, "domain", f.Domain)
	setQuery(query, "integration_id", f.IntegrationID)
	setQuery(query, "status", f.Status)
	setQuery(query, "webhook_status", f.WebhookStatus)
	setLimitCursor(query, f.Limit, f.Cursor)
	var envelope listEnvelope
	if err := c.get(ctx, actor, "/admin/v1/installations", query, &envelope); err != nil {
		return adapter.Observation[adapter.Page[adapter.ConnectionSummary]]{}, err
	}
	raw, err := decodeList[installationSummary](envelope.Items)
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.ConnectionSummary]]{}, adapter.Unavailable(c.desc.Code, "core returned invalid json")
	}
	items := make([]adapter.ConnectionSummary, 0, len(raw))
	for _, item := range raw {
		items = append(items, mapInstallation(item))
	}
	return adapter.Fresh(c.desc.Code, envelope.ObservedAt, adapter.Page[adapter.ConnectionSummary]{
		Items: items, NextCursor: envelope.NextCursor, Total: envelope.Total,
	}), nil
}

func (c *Client) GetConnection(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[adapter.ConnectionDetail], error) {
	var resp installationResponse
	if err := c.get(ctx, actor, "/admin/v1/installations/"+id, nil, &resp); err != nil {
		return adapter.Observation[adapter.ConnectionDetail]{}, err
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, mapConnectionDetail(resp)), nil
}

func (c *Client) ListConnectionJobs(ctx context.Context, actor adapter.Actor, id string, f adapter.JobFilter) (adapter.Observation[adapter.Page[adapter.Job]], error) {
	return c.listJobs(ctx, actor, "/admin/v1/installations/"+id+"/jobs", f, false)
}

func (c *Client) ListConnectionAudit(ctx context.Context, actor adapter.Actor, id string, f adapter.PageFilter) (adapter.Observation[adapter.Page[adapter.AuditEntry]], error) {
	query := url.Values{}
	setLimitCursor(query, f.Limit, f.Cursor)
	var envelope listEnvelope
	if err := c.get(ctx, actor, "/admin/v1/installations/"+id+"/audit", query, &envelope); err != nil {
		return adapter.Observation[adapter.Page[adapter.AuditEntry]]{}, err
	}
	raw, err := decodeList[auditEntry](envelope.Items)
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.AuditEntry]]{}, adapter.Unavailable(c.desc.Code, "core returned invalid json")
	}
	items := make([]adapter.AuditEntry, 0, len(raw))
	for _, item := range raw {
		items = append(items, mapAudit(item))
	}
	return adapter.Fresh(c.desc.Code, envelope.ObservedAt, adapter.Page[adapter.AuditEntry]{
		Items: items, NextCursor: envelope.NextCursor, Total: envelope.Total,
	}), nil
}

func (c *Client) ListConnectionDeliveries(ctx context.Context, actor adapter.Actor, id string, f adapter.PageFilter) (adapter.Observation[[]adapter.Delivery], error) {
	query := url.Values{}
	if f.Limit > 0 {
		query.Set("limit", strconv.Itoa(f.Limit))
	}
	var resp deliveriesResponse
	if err := c.get(ctx, actor, "/admin/v1/installations/"+id+"/activity/deliveries", query, &resp); err != nil {
		return adapter.Observation[[]adapter.Delivery]{}, err
	}
	items := make([]adapter.Delivery, 0, len(resp.Items))
	for _, item := range resp.Items {
		items = append(items, mapDelivery(item))
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, items), nil
}

func (c *Client) ListIntegrations(ctx context.Context, actor adapter.Actor, f adapter.PageFilter) (adapter.Observation[adapter.Page[adapter.Integration]], error) {
	query := url.Values{}
	setLimitCursor(query, f.Limit, f.Cursor)
	var envelope listEnvelope
	if err := c.get(ctx, actor, "/admin/v1/integrations", query, &envelope); err != nil {
		return adapter.Observation[adapter.Page[adapter.Integration]]{}, err
	}
	raw, err := decodeList[integration](envelope.Items)
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.Integration]]{}, adapter.Unavailable(c.desc.Code, "core returned invalid json")
	}
	items := make([]adapter.Integration, 0, len(raw))
	for _, item := range raw {
		items = append(items, mapIntegration(item))
	}
	return adapter.Fresh(c.desc.Code, envelope.ObservedAt, adapter.Page[adapter.Integration]{
		Items: items, NextCursor: envelope.NextCursor, Total: envelope.Total,
	}), nil
}

func (c *Client) GetIntegration(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[adapter.Integration], error) {
	var resp integrationResponse
	if err := c.get(ctx, actor, "/admin/v1/integrations/"+id, nil, &resp); err != nil {
		return adapter.Observation[adapter.Integration]{}, err
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, mapIntegration(resp.Integration)), nil
}

func (c *Client) ListJobs(ctx context.Context, actor adapter.Actor, f adapter.JobFilter) (adapter.Observation[adapter.Page[adapter.Job]], error) {
	return c.listJobs(ctx, actor, "/admin/v1/jobs", f, true)
}

func (c *Client) GetJob(ctx context.Context, actor adapter.Actor, id string) (adapter.Observation[adapter.JobDetail], error) {
	var resp jobResponse
	if err := c.get(ctx, actor, "/admin/v1/jobs/"+id, nil, &resp); err != nil {
		return adapter.Observation[adapter.JobDetail]{}, err
	}
	attempts := make([]adapter.JobAttempt, 0, len(resp.Attempts))
	for _, item := range resp.Attempts {
		attempts = append(attempts, mapJobAttempt(item))
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, adapter.JobDetail{
		Job: mapJob(resp.Job), Attempts: attempts,
	}), nil
}

func (c *Client) JobsSummary(ctx context.Context, actor adapter.Actor) (adapter.Observation[adapter.JobsSummary], error) {
	var resp jobsSummaryResponse
	if err := c.get(ctx, actor, "/admin/v1/jobs/summary", nil, &resp); err != nil {
		return adapter.Observation[adapter.JobsSummary]{}, err
	}
	counts := resp.Counts
	if counts == nil {
		counts = map[string]int{}
	}
	return adapter.Fresh(c.desc.Code, resp.ObservedAt, adapter.JobsSummary{Counts: counts}), nil
}

func (c *Client) listJobs(ctx context.Context, actor adapter.Actor, path string, f adapter.JobFilter, requireWindow bool) (adapter.Observation[adapter.Page[adapter.Job]], error) {
	query := url.Values{}
	setQuery(query, "status", f.Status)
	setQuery(query, "type", f.Type)
	if requireWindow && f.Since != nil {
		query.Set("since", f.Since.UTC().Format(time.RFC3339))
	}
	setLimitCursor(query, f.Limit, f.Cursor)
	var envelope listEnvelope
	if err := c.get(ctx, actor, path, query, &envelope); err != nil {
		return adapter.Observation[adapter.Page[adapter.Job]]{}, err
	}
	raw, err := decodeList[job](envelope.Items)
	if err != nil {
		return adapter.Observation[adapter.Page[adapter.Job]]{}, adapter.Unavailable(c.desc.Code, "core returned invalid json")
	}
	items := make([]adapter.Job, 0, len(raw))
	for _, item := range raw {
		items = append(items, mapJob(item))
	}
	return adapter.Fresh(c.desc.Code, envelope.ObservedAt, adapter.Page[adapter.Job]{
		Items: items, NextCursor: envelope.NextCursor, Total: envelope.Total,
	}), nil
}

func (c *Client) get(ctx context.Context, actor adapter.Actor, path string, query url.Values, dest any) error {
	ctx, cancel := context.WithTimeout(ctx, c.desc.Timeout)
	defer cancel()

	target, err := c.resolve(path, query)
	if err != nil {
		return adapter.Unavailable(c.desc.Code, "invalid core url")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return adapter.Unavailable(c.desc.Code, "core request failed")
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Admin-Actor", actor.Value)
	req.Header.Set("Accept", "application/json")
	if id := httpx.RequestIDFromContext(ctx); id != uuid.Nil {
		req.Header.Set("X-Request-ID", id.String())
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return c.mapTransport(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return c.mapTransport(err)
	}
	if len(body) > maxResponseBytes {
		return adapter.Unavailable(c.desc.Code, "core response is too large")
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if err := json.Unmarshal(body, dest); err != nil {
			return adapter.Unavailable(c.desc.Code, "core returned invalid json")
		}
		return nil
	}
	return c.mapStatus(resp.StatusCode, body)
}

func (c *Client) resolve(path string, query url.Values) (string, error) {
	rel, err := url.Parse(path)
	if err != nil {
		return "", err
	}
	target := c.baseURL.ResolveReference(rel)
	if query != nil {
		target.RawQuery = query.Encode()
	}
	return target.String(), nil
}

func (c *Client) mapTransport(err error) error {
	if errors.Is(err, context.DeadlineExceeded) || isTimeout(err) {
		return adapter.Timeout(c.desc.Code, "core request timed out")
	}
	return adapter.Unavailable(c.desc.Code, "core unavailable")
}

func (c *Client) mapStatus(status int, body []byte) error {
	message := coreMessage(body)
	switch status {
	case http.StatusNotFound:
		if message == "" {
			message = "not found"
		}
		return adapter.NotFound(c.desc.Code, message)
	case http.StatusBadRequest:
		if message == "" {
			message = "invalid argument"
		}
		return adapter.InvalidArgument(c.desc.Code, message)
	case http.StatusUnauthorized, http.StatusForbidden:
		return adapter.Unavailable(c.desc.Code, "core admin authentication failed")
	case http.StatusGatewayTimeout, http.StatusRequestTimeout:
		return adapter.Timeout(c.desc.Code, "core request timed out")
	default:
		return adapter.Unavailable(c.desc.Code, "core unavailable")
	}
}

func coreMessage(body []byte) string {
	var envelope errorEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return ""
	}
	return strings.TrimSpace(envelope.Error.Message)
}

func isTimeout(err error) bool {
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

func decodeList[T any](raw json.RawMessage) ([]T, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return []T{}, nil
	}
	var items []T
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	if items == nil {
		items = []T{}
	}
	return items, nil
}

func setQuery(query url.Values, key, value string) {
	if strings.TrimSpace(value) != "" {
		query.Set(key, value)
	}
}

func setLimitCursor(query url.Values, limit int, cursor string) {
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	setQuery(query, "cursor", cursor)
}
