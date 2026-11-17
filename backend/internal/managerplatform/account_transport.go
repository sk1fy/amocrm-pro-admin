package managerplatform

import (
	"bytes"
	"context"
	"net/http"
	"net/url"
	"strconv"

	"github.com/google/uuid"

	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

func (c *Client) callAccount(ctx context.Context, action accountAction, actor string, target uuid.UUID,
	query url.Values, body []byte, item intent,
) (*http.Response, error) {
	const media = "application/json"
	etag := strconv.Quote(strconv.FormatInt(item.Version, 10))
	editQuery := func(_ context.Context, request *http.Request) error {
		request.URL.RawQuery = query.Encode()
		return nil
	}
	switch action {
	case "listProducts":
		return c.wire.ListProducts(ctx, &wire.ListProductsParams{XPlatformActor: actor}, editQuery)
	case "getProduct":
		return c.wire.GetProduct(ctx, target, &wire.GetProductParams{XPlatformActor: actor}, editQuery)
	case "getProductMetrics":
		return c.wire.GetProductMetrics(ctx, target, &wire.GetProductMetricsParams{XPlatformActor: actor}, editQuery)
	case "createProduct":
		return c.wire.CreateProductWithBody(ctx, &wire.CreateProductParams{XPlatformActor: actor, IdempotencyKey: item.Key}, media, bytes.NewReader(body), editQuery)
	case "updateProduct":
		return c.wire.UpdateProductWithBody(ctx, target, &wire.UpdateProductParams{XPlatformActor: actor, IdempotencyKey: item.Key, IfMatch: etag}, media, bytes.NewReader(body), editQuery)

	case "listAccounts":
		return c.wire.ListAccounts(ctx, &wire.ListAccountsParams{XPlatformActor: actor}, editQuery)
	case "searchAccounts":
		return c.wire.SearchAccountsWithBody(ctx, &wire.SearchAccountsParams{XPlatformActor: actor}, media, bytes.NewReader(body), editQuery)
	case "getAccount":
		return c.wire.GetAccount(ctx, target, &wire.GetAccountParams{XPlatformActor: actor}, editQuery)
	case "updateAccountProfile":
		return c.wire.UpdateAccountProfileWithBody(ctx, target, &wire.UpdateAccountProfileParams{XPlatformActor: actor, IdempotencyKey: item.Key, IfMatch: etag}, media, bytes.NewReader(body), editQuery)
	case "requestAccountRefresh":
		return c.wire.RequestAccountRefreshWithBody(ctx, target, &wire.RequestAccountRefreshParams{XPlatformActor: actor, IdempotencyKey: item.Key}, media, bytes.NewReader(body), editQuery)
	case "getAccountLicenseHistory":
		return c.wire.GetAccountLicenseHistory(ctx, target, &wire.GetAccountLicenseHistoryParams{XPlatformActor: actor}, editQuery)
	case "listAccountWidgets":
		return c.wire.ListAccountWidgets(ctx, target, &wire.ListAccountWidgetsParams{XPlatformActor: actor}, editQuery)
	case "getAccountCRMUsers":
		return c.wire.GetAccountCRMUsers(ctx, target, &wire.GetAccountCRMUsersParams{XPlatformActor: actor}, editQuery)
	case "createAccountRenewal":
		return c.wire.CreateAccountRenewalWithBody(ctx, target, &wire.CreateAccountRenewalParams{XPlatformActor: actor, IdempotencyKey: item.Key, IfMatch: etag}, media, bytes.NewReader(body), editQuery)
	case "getAccountPortrait":
		return c.wire.GetAccountPortrait(ctx, target, &wire.GetAccountPortraitParams{XPlatformActor: actor}, editQuery)
	case "updateAccountPortrait":
		return c.wire.UpdateAccountPortraitWithBody(ctx, target, &wire.UpdateAccountPortraitParams{XPlatformActor: actor, IdempotencyKey: item.Key, IfMatch: etag}, media, bytes.NewReader(body), editQuery)
	case "createPortraitAuditDate":
		return c.wire.CreatePortraitAuditDateWithBody(ctx, target, &wire.CreatePortraitAuditDateParams{XPlatformActor: actor, IdempotencyKey: item.Key, IfMatch: etag}, media, bytes.NewReader(body), editQuery)
	case "getPortraitTemplate":
		return c.wire.GetPortraitTemplate(ctx, &wire.GetPortraitTemplateParams{XPlatformActor: actor}, editQuery)
	case "setPortraitTemplate":
		return c.wire.SetPortraitTemplateWithBody(ctx, &wire.SetPortraitTemplateParams{XPlatformActor: actor, IdempotencyKey: item.Key, IfMatch: etag}, media, bytes.NewReader(body), editQuery)
	case "listPortraitNiches":
		return c.wire.ListPortraitNiches(ctx, &wire.ListPortraitNichesParams{XPlatformActor: actor}, editQuery)
	case "createPortraitNiche":
		return c.wire.CreatePortraitNicheWithBody(ctx, &wire.CreatePortraitNicheParams{XPlatformActor: actor, IdempotencyKey: item.Key}, media, bytes.NewReader(body), editQuery)
	case "updatePortraitNiche":
		return c.wire.UpdatePortraitNicheWithBody(ctx, target, &wire.UpdatePortraitNicheParams{XPlatformActor: actor, IdempotencyKey: item.Key, IfMatch: etag}, media, bytes.NewReader(body), editQuery)
	case "deletePortraitNiche":
		return c.wire.DeletePortraitNiche(ctx, target, &wire.DeletePortraitNicheParams{XPlatformActor: actor, IdempotencyKey: item.Key, IfMatch: etag}, editQuery)
	case "mergePortraitNiche":
		return c.wire.MergePortraitNicheWithBody(ctx, target, &wire.MergePortraitNicheParams{XPlatformActor: actor, IdempotencyKey: item.Key, IfMatch: etag}, media, bytes.NewReader(body), editQuery)
	default:
		return nil, ErrInvalid
	}
}
