package managerplatform

import (
	"github.com/google/uuid"

	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
)

type commandKind string

const (
	kindCreateProduct commandKind = "product.create"
	kindUpdateProduct commandKind = "product.update"
	kindReview        commandKind = "installation.review"
	kindRetryDeal     commandKind = "installation.crm_deal.retry"
	kindProfile       commandKind = "account.profile"
	kindPortrait      commandKind = "account.portrait"
	kindAuditDate     commandKind = "account.portrait_audit_date"
	kindRefresh       commandKind = "account.refresh"
	kindRenewal       commandKind = "account.renewal"
	kindTemplate      commandKind = "portrait.template"
	kindCreateNiche   commandKind = "portrait.niche.create"
	kindUpdateNiche   commandKind = "portrait.niche.update"
	kindDeleteNiche   commandKind = "portrait.niche.delete"
	kindMergeNiche    commandKind = "portrait.niche.merge"
)

type commandPolicy struct {
	grant   auth.ManagerGrant
	target  string
	bound   bool
	version bool
	related bool
	async   bool
}

func (kind commandKind) policy() commandPolicy {
	switch kind {
	case kindCreateProduct:
		return commandPolicy{grant: auth.GrantCatalogManage, target: "product"}
	case kindUpdateProduct:
		return commandPolicy{grant: auth.GrantCatalogManage, target: "product", bound: true, version: true}
	case kindReview, kindRetryDeal:
		return commandPolicy{grant: auth.GrantClientsWrite, target: "installation", bound: true, version: true, async: kind == kindRetryDeal}
	case kindProfile, kindPortrait, kindAuditDate:
		return commandPolicy{grant: auth.GrantClientsWrite, target: "account", bound: true, version: true}
	case kindRefresh:
		return commandPolicy{grant: auth.GrantClientsWrite, target: "account", bound: true, async: true}
	case kindRenewal:
		return commandPolicy{grant: auth.GrantClientsRenew, target: "account", bound: true, version: true, related: true}
	case kindTemplate:
		return commandPolicy{grant: auth.GrantConfigurationManage, target: "portrait_template", version: true}
	case kindCreateNiche:
		return commandPolicy{grant: auth.GrantConfigurationManage, target: "niche"}
	case kindUpdateNiche, kindDeleteNiche, kindMergeNiche:
		return commandPolicy{grant: auth.GrantConfigurationManage, target: "niche", bound: true, version: true, related: kind == kindMergeNiche}
	default:
		return commandPolicy{}
	}
}

func (policy commandPolicy) validates(meta CommandMeta) bool {
	return policy.grant != "" && meta.IdempotencyKey != uuid.Nil &&
		policy.bound == (meta.TargetID != uuid.Nil) && policy.related == (meta.RelatedID != uuid.Nil) &&
		meta.ExpectedVersion >= 0 && meta.ExpectedVersion <= MaxVersion && policy.version == (meta.ExpectedVersion > 0)
}

func (kind commandKind) pollGrant() auth.ManagerGrant {
	if kind == kindReview || kind == kindRetryDeal {
		return auth.GrantClientsRead
	}
	return kind.policy().grant
}
