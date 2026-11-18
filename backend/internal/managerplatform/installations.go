package managerplatform

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

func (s *Service) ListInstallations(ctx context.Context, filters wire.ListInstallationsParams) (*wire.InstallationList, error) {
	ctx, cancel := context.WithTimeout(ctx, maxTimeout)
	defer cancel()
	identity, ok := auth.PrincipalFromContext(ctx)
	if !ok || identity.Audience != auth.Managers {
		return nil, auth.ErrUnauthenticated
	}
	actor, err := s.snapshot(ctx, identity.SessionID, identity.EmployeeID, auth.GrantClientsRead)
	if err != nil {
		return nil, err
	}
	page, err := s.client.listInstallations(ctx, actor, filters)
	if err != nil {
		return nil, err
	}
	current, err := s.snapshot(ctx, identity.SessionID, identity.EmployeeID, auth.GrantClientsRead)
	if err != nil {
		return nil, err
	}
	if current.Account.ManagerGrantsVersion != actor.Account.ManagerGrantsVersion {
		if filters.Cursor != nil {
			return nil, &PeerError{Status: http.StatusBadRequest, Code: "invalid_cursor"}
		}
		return nil, ErrUnavailable
	}
	return page, nil
}

func (c *Client) listInstallations(ctx context.Context, principal auth.Principal, filters wire.ListInstallationsParams) (*wire.InstallationList, error) {
	actor, err := c.actor(ctx, principal, nil)
	if err != nil {
		return nil, err
	}
	filters.XPlatformActor = actor
	res, err := c.wire.ListInstallationsWithResponse(ctx, &filters)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	if res.JSON200 == nil {
		return nil, peerError(res.HTTPResponse, res.Body)
	}
	if !validInstallationList(res.HTTPResponse, res.Body, res.JSON200, filters.Limit) {
		return nil, ErrUnavailable
	}
	return res.JSON200, nil
}

func validInstallationList(response *http.Response, raw []byte, page *wire.InstallationList, requestedLimit *int) bool {
	var members struct {
		Items   []json.RawMessage
		Summary json.RawMessage
	}
	summary := page.Summary
	hash, err := hex.DecodeString(page.QueryHash)
	limit := 25
	if requestedLimit != nil {
		limit = *requestedLimit
	}
	if !jsonMedia(response) || page.SnapshotAt.IsZero() || !page.NextCursor.IsSpecified() ||
		page.Items == nil || summary.Total < len(page.Items) || len(page.Items) > limit ||
		summary.Reviewed < 0 || summary.Unreviewed < 0 || summary.Reviewed > summary.Total ||
		summary.Unreviewed != summary.Total-summary.Reviewed || err != nil || len(hash) != 32 ||
		json.Unmarshal(raw, &members) != nil || len(page.Items) != len(members.Items) ||
		!hasJSONMembers(members.Summary, "total", "reviewed", "unreviewed") {
		return false
	}
	if cursor, err := page.NextCursor.Get(); err == nil && (cursor == "" || utf8.RuneCountInString(cursor) > 200) {
		return false
	}
	seen := make(map[uuid.UUID]bool, len(page.Items))
	for i := range page.Items {
		item := &page.Items[i]
		if seen[item.Id] || !validInstallation(members.Items[i], item) {
			return false
		}
		seen[item.Id] = true
	}
	return true
}

var productCodePattern = regexp.MustCompile(`^[a-z0-9]+(?:[-_][a-z0-9]+)*$`)

func validInstallation(raw []byte, item *wire.Installation) bool {
	amoID, err := strconv.ParseInt(string(item.AmoAccountId), 10, 64)
	access := item.Access
	review := item.Review
	if item.Id == uuid.Nil || item.AccountId == uuid.Nil || item.ProductId == uuid.Nil ||
		item.CoreInstallationId == uuid.Nil || err != nil || amoID < 1 ||
		strconv.FormatInt(amoID, 10) != string(item.AmoAccountId) ||
		len(item.ProductCode) > 63 || !productCodePattern.MatchString(string(item.ProductCode)) ||
		!validVersion(item.Version) || !validVersion(item.Generation) ||
		item.InstalledAt.IsZero() || !item.RemovedAt.IsSpecified() ||
		!item.Kind.Valid() || !item.Lifecycle.Valid() || !item.LastLifecycleEvent.Valid() ||
		!item.Authorization.Valid() || !item.ActivationStatus.Valid() || !item.CrmWorkflow.Valid() ||
		access.AccountId != item.AccountId || access.ProductId != item.ProductId ||
		!access.Source.Valid() || !access.ValidUntil.IsSpecified() || !access.OwnUntil.IsSpecified() ||
		access.ReasonCodes == nil || !validVersion(access.EntitlementVersion) || access.ComputedAt.IsZero() ||
		(review.ReviewedBy != nil && *review.ReviewedBy == uuid.Nil) ||
		(review.ReviewedAt != nil && review.ReviewedAt.IsZero()) {
		return false
	}
	var members map[string]json.RawMessage
	return json.Unmarshal(raw, &members) == nil && nonNullJSON(members["product_name"]) &&
		hasJSONMembers(members["access"], "active") && hasJSONMembers(members["review"], "reviewed")
}

func hasJSONMembers(raw []byte, keys ...string) bool {
	var members map[string]json.RawMessage
	if json.Unmarshal(raw, &members) != nil {
		return false
	}
	for _, key := range keys {
		if !nonNullJSON(members[key]) {
			return false
		}
	}
	return true
}

func nonNullJSON(raw []byte) bool { return len(raw) != 0 && !bytes.Equal(raw, []byte("null")) }

func validVersion(version int) bool { return version >= 1 && version <= MaxVersion }

func jsonMedia(response *http.Response) bool {
	media, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	return err == nil && media == "application/json"
}
