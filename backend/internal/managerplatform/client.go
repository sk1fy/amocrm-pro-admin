package managerplatform

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/google/uuid"

	"github.com/sk1fy/amocrm-pro-admin/api"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

const (
	MaxVersion = 9_007_199_254_740_991
	maxTimeout = 30 * time.Second
	managerBFF = "spiffe://amocrm-pro/manager-bff"
)

var ErrUnavailable = errors.New("platform is unavailable")

type ClientConfig struct {
	URL      string
	CAFile   string
	CertFile string
	KeyFile  string
	Timeout  time.Duration
}

type Client struct {
	wire      *wire.ClientWithResponses
	transport *http.Transport
	timeout   time.Duration
	contract  *openapi3.T
}

func NewClient(cfg ClientConfig) (*Client, error) {
	endpoint, err := url.Parse(cfg.URL)
	if err != nil || endpoint.Scheme != "https" || endpoint.Hostname() == "" ||
		endpoint.User != nil || (endpoint.Path != "" && endpoint.Path != "/") ||
		endpoint.RawQuery != "" || endpoint.ForceQuery || strings.Contains(cfg.URL, "#") {
		return nil, errors.New("MANAGERS_PLATFORM_URL must be an HTTPS origin")
	}
	if port := endpoint.Port(); port != "" || strings.HasSuffix(endpoint.Host, ":") {
		value, err := strconv.Atoi(port)
		if err != nil || value < 1 || value > 65535 {
			return nil, errors.New("MANAGERS_PLATFORM_URL must use a valid TCP port")
		}
	}
	if _, err := netip.ParseAddr(endpoint.Hostname()); err == nil {
		return nil, errors.New("MANAGERS_PLATFORM_URL must use the Platform DNS name")
	}
	if cfg.Timeout < time.Second || cfg.Timeout > maxTimeout {
		return nil, errors.New("MANAGERS_PLATFORM_TIMEOUT must be between 1s and 30s")
	}
	pem, err := os.ReadFile(cfg.CAFile)
	if err != nil {
		return nil, errors.New("cannot read Platform CA file")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(pem) {
		return nil, errors.New("invalid Platform CA bundle")
	}
	pair, err := tls.LoadX509KeyPair(cfg.CertFile, cfg.KeyFile)
	if err != nil || pair.Leaf == nil || len(pair.Leaf.URIs) != 1 || pair.Leaf.URIs[0].String() != managerBFF {
		return nil, errors.New("invalid Platform Manager BFF certificate or private key")
	}
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion:   tls.VersionTLS13,
			RootCAs:      roots,
			Certificates: []tls.Certificate{pair},
		},
		TLSHandshakeTimeout:   cfg.Timeout,
		ResponseHeaderTimeout: cfg.Timeout,
		MaxIdleConns:          4,
		IdleConnTimeout:       30 * time.Second,
	}
	httpClient := &http.Client{
		Transport:     platformTransport{transport},
		Timeout:       cfg.Timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	generated, err := wire.NewClientWithResponses(endpoint.String(), wire.WithHTTPClient(httpClient))
	if err != nil {
		return nil, fmt.Errorf("create Platform wire client: %w", err)
	}
	contract, err := api.LoadPlatformContract()
	if err != nil {
		return nil, fmt.Errorf("load pinned Platform contract: %w", err)
	}
	return &Client{wire: generated, transport: transport, timeout: cfg.Timeout, contract: contract}, nil
}

func (c *Client) Close() { c.transport.CloseIdleConnections() }

type platformTransport struct{ next *http.Transport }

func (t platformTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Method != http.MethodGet {
		// A network retry belongs to the intent service after receipt lookup.
		req = req.Clone(req.Context())
		req.GetBody = nil
		req.Close = true
	}
	resp, err := t.next.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	resp.Body = http.MaxBytesReader(nil, resp.Body, 1<<20)
	return resp, nil
}

type PeerError struct {
	Status         int
	Code           string
	Version        *int
	RetryAfter     *int
	OutcomeUnknown bool
}

func (e *PeerError) Error() string { return fmt.Sprintf("Platform status %d", e.Status) }

func peerError(response *http.Response, body []byte) error {
	status := response.StatusCode
	switch status {
	case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound,
		http.StatusConflict, http.StatusUnprocessableEntity, http.StatusTooManyRequests, http.StatusServiceUnavailable:
		var result wire.Error
		if !jsonMedia(response) || json.Unmarshal(body, &result) != nil ||
			result.Error.RequestId == uuid.Nil || result.Error.Code == "" {
			// A generic 404 (e.g. unmounted P02 route) is not a typed receipt.
			return ErrUnavailable
		}
		retryAfter := result.Error.RetryAfterSeconds
		if retryAfter != nil && *retryAfter < 0 {
			retryAfter = nil
		}
		if seconds := retryAfterSeconds(response.Header.Get("Retry-After")); seconds != nil {
			retryAfter = seconds
		}
		return &PeerError{
			Status:         status,
			Code:           result.Error.Code,
			Version:        result.Error.CurrentVersion,
			RetryAfter:     retryAfter,
			OutcomeUnknown: result.Error.Code == "unknown_outcome",
		}
	default:
		return ErrUnavailable
	}
}

func retryAfterSeconds(header string) *int {
	if seconds, err := strconv.Atoi(header); err == nil && seconds >= 0 {
		return &seconds
	}
	if end, err := http.ParseTime(header); err == nil {
		remaining := time.Until(end)
		if remaining <= 0 {
			return new(int)
		}
		seconds := int(remaining / time.Second)
		if remaining%time.Second != 0 {
			seconds++
		}
		return &seconds
	}
	return nil
}

func (c *Client) actor(ctx context.Context, principal auth.Principal, commandID *uuid.UUID) (string, error) {
	version := principal.Account.ManagerGrantsVersion
	if principal.Audience != auth.Managers || principal.SessionID == uuid.Nil || principal.EmployeeID == uuid.Nil ||
		version < 1 || version > MaxVersion || len(principal.Account.ManagerGrants) == 0 {
		return "", auth.ErrUnauthenticated
	}
	grants := make([]wire.Grant, 0, len(principal.Account.ManagerGrants))
	for _, grant := range principal.Account.ManagerGrants {
		grants = append(grants, wire.Grant(grant))
	}
	now := time.Now().UTC()
	requestID := httpx.RequestIDFromContext(ctx)
	if requestID == uuid.Nil {
		requestID = uuid.New()
	}
	deadline := now.Add(c.timeout)
	if end, ok := ctx.Deadline(); ok && end.Before(deadline) {
		deadline = end.UTC()
	}
	if !deadline.After(now) {
		return "", context.DeadlineExceeded
	}
	data, err := json.Marshal(wire.ManagerContext{
		Actor: wire.ManagerActor{
			Audience: wire.Managers, Kind: wire.Employee, SessionId: principal.SessionID,
			SubjectId: principal.EmployeeID, Grants: grants, GrantsVersion: int(version),
		},
		CommandId: commandID, RequestId: requestID, IssuedAt: now, DeadlineAt: deadline,
	})
	if err != nil {
		return "", fmt.Errorf("encode Platform actor: %w", err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(data)
	if len(encoded) > 4096 {
		return "", errors.New("platform actor exceeds contract size")
	}
	return encoded, nil
}

func (c *Client) receipt(ctx context.Context, principal auth.Principal, id uuid.UUID) (*wire.CommandReceipt, error) {
	actor, err := c.actor(ctx, principal, nil)
	if err != nil {
		return nil, err
	}
	res, err := c.wire.GetCommandReceiptWithResponse(ctx, id, &wire.GetCommandReceiptParams{XPlatformActor: actor})
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	if res.JSON200 == nil {
		return nil, peerError(res.HTTPResponse, res.Body)
	}
	if res.JSON200.Id != id || res.JSON200.Kind == "" || !res.JSON200.State.Valid() ||
		(res.JSON200.OperationId != nil && *res.JSON200.OperationId != id) ||
		(res.JSON200.State == wire.CommandReceiptStateAccepted && res.JSON200.OperationId == nil) {
		return nil, ErrUnavailable
	}
	return res.JSON200, nil
}

func (c *Client) operation(ctx context.Context, principal auth.Principal, intent intent) (*wire.Operation, error) {
	actor, err := c.actor(ctx, principal, nil)
	if err != nil {
		return nil, err
	}
	res, err := c.wire.GetOperationWithResponse(ctx, intent.ID, &wire.GetOperationParams{XPlatformActor: actor})
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	if res.JSON200 == nil {
		return nil, peerError(res.HTTPResponse, res.Body)
	}
	if !validOperation(res.JSON200, intent) {
		return nil, ErrUnavailable
	}
	return res.JSON200, nil
}

func (c *Client) review(ctx context.Context, principal auth.Principal, intent intent, body wire.SetInstallationReviewJSONRequestBody) (*wire.Installation, error) {
	actor, err := c.actor(ctx, principal, &intent.ID)
	if err != nil {
		return nil, err
	}
	res, err := c.wire.SetInstallationReviewWithResponse(ctx, intent.TargetID, &wire.SetInstallationReviewParams{
		XPlatformActor: actor, IdempotencyKey: intent.Key, IfMatch: strconv.Quote(strconv.FormatInt(intent.Version, 10)),
	}, body)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	if res.JSON200 == nil {
		return nil, peerError(res.HTTPResponse, res.Body)
	}
	if res.JSON200.Id != intent.TargetID || res.JSON200.Review.Reviewed != body.Reviewed ||
		int64(res.JSON200.Version) < intent.Version || !jsonMedia(res.HTTPResponse) ||
		!validInstallation(res.Body, res.JSON200) ||
		res.HTTPResponse.Header.Get("ETag") != strconv.Quote(strconv.Itoa(res.JSON200.Version)) {
		return nil, ErrUnavailable
	}
	return res.JSON200, nil
}

func (c *Client) retryDeal(ctx context.Context, principal auth.Principal, intent intent, body wire.RetryInstallationDealJSONRequestBody) (*wire.Operation, error) {
	actor, err := c.actor(ctx, principal, &intent.ID)
	if err != nil {
		return nil, err
	}
	res, err := c.wire.RetryInstallationDealWithResponse(ctx, intent.TargetID, &wire.RetryInstallationDealParams{
		XPlatformActor: actor, IdempotencyKey: intent.Key, IfMatch: strconv.Quote(strconv.FormatInt(intent.Version, 10)),
	}, body)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	if res.JSON202 == nil {
		return nil, peerError(res.HTTPResponse, res.Body)
	}
	if !validOperation(res.JSON202, intent) {
		return nil, ErrUnavailable
	}
	return res.JSON202, nil
}

func validOperation(op *wire.Operation, intent intent) bool {
	return op.Id == intent.ID && op.Target.Id == intent.TargetID &&
		op.Target.Kind == intent.Kind.policy().target && op.Kind != "" &&
		(intent.Kind == kindRetryDeal || op.Kind == string(intent.Kind)) &&
		!op.CreatedAt.IsZero() && !op.UpdatedAt.IsZero() && op.State.Valid() &&
		(op.RetryAfterSeconds == nil || *op.RetryAfterSeconds >= 0)
}
