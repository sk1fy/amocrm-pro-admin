package core

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/httpx"
)

func (c *Client) ExecuteCommand(ctx context.Context, actor adapter.Actor, key string, command adapter.CommandRequest) (adapter.CommandResult, error) {
	raw, err := json.Marshal(command)
	if err != nil {
		return adapter.CommandResult{}, adapter.ErrInvalidArgument
	}
	ctx, cancel := context.WithTimeout(ctx, c.desc.Timeout)
	defer cancel()
	target, err := c.resolve("/admin/v1/commands", nil)
	if err != nil {
		return adapter.CommandResult{}, adapter.ErrUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(raw))
	if err != nil {
		return adapter.CommandResult{}, adapter.ErrUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Admin-Actor", actor.Value)
	req.Header.Set("Idempotency-Key", key)
	req.Header.Set("Content-Type", "application/json")
	if id := httpx.RequestIDFromContext(ctx); id != uuid.Nil {
		req.Header.Set("X-Request-ID", id.String())
	}
	// Never follow redirects for mutations (including 307/308 body forwarding).
	client := *c.httpClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(req)
	if err != nil {
		return adapter.CommandResult{}, c.mapTransport(err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return adapter.CommandResult{}, c.mapTransport(err)
	}
	if len(body) > maxResponseBytes {
		return adapter.CommandResult{}, adapter.ErrUnavailable
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return adapter.CommandResult{}, adapter.Error{Kind: adapter.ErrRejected, Backend: c.desc.Code, Message: "core admin authentication failed"}
	}
	if response.StatusCode == http.StatusConflict {
		return adapter.CommandResult{}, adapter.Error{Kind: adapter.ErrConflict, Backend: c.desc.Code, Message: "command conflicts with current state"}
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusAccepted {
		return adapter.CommandResult{}, c.mapStatus(response.StatusCode, body)
	}
	var result adapter.CommandResult
	if json.Unmarshal(body, &result) != nil || result.ID == "" || result.State == "" {
		return result, adapter.ErrUnavailable
	}
	return result, nil
}

func (c *Client) GetCommand(ctx context.Context, actor adapter.Actor, id string) (adapter.CommandResult, error) {
	if _, err := uuid.Parse(id); err != nil {
		return adapter.CommandResult{}, adapter.ErrInvalidArgument
	}
	var result adapter.CommandResult
	err := c.get(ctx, actor, "/admin/v1/commands/"+id, nil, &result)
	if err == nil && (result.ID != id || result.State == "") {
		return adapter.CommandResult{}, adapter.ErrUnavailable
	}
	if err == nil && result.ObservedAt.IsZero() {
		result.ObservedAt = time.Now().UTC()
	}
	return result, err
}
