package managerplatform

import (
	"net/url"
	"strconv"
	"time"

	"github.com/google/uuid"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

// These identifiers belong to different identity spaces, even when encoded as UUIDs.
type CompanyProjectionID uuid.UUID
type RuntimeAccountID uuid.UUID
type ProductID uuid.UUID

func validCRMID(value string) bool {
	number, err := strconv.ParseInt(value, 10, 64)
	return err == nil && number > 0 && strconv.FormatInt(number, 10) == value
}

func validCompanySource(source *wire.CompanySource) bool {
	if !source.State.Valid() || !source.SourceAccountId.IsSpecified() || !source.BindingRevision.IsSpecified() ||
		!source.ObservedAt.IsSpecified() || !source.FreshUntil.IsSpecified() || !source.ErrorCode.IsSpecified() || !source.RetryAt.IsSpecified() {
		return false
	}
	account, ae := source.SourceAccountId.Get()
	binding, be := source.BindingRevision.Get()
	if (ae == nil) != (be == nil) || (ae == nil && (!validCRMID(account) || binding == "")) {
		return false
	}
	observed, oe := source.ObservedAt.Get()
	fresh, fe := source.FreshUntil.Get()
	if (oe == nil) != (fe == nil) || (oe == nil && (observed.IsZero() || fresh.Before(observed))) {
		return false
	}
	if source.Complete && (oe != nil || ae != nil) {
		return false
	}
	if source.State == wire.CompanySourceStateFresh {
		if !source.Complete {
			return false
		}
		if !fresh.After(time.Now()) {
			source.State = wire.CompanySourceStateStale
		}
	}
	return true
}

func validCompanySummary(item wire.CompanySummary) bool {
	if item.Id == uuid.Nil || !validCRMID(item.CrmCompanyId) || item.CustomerAccountIds == nil || item.RuntimeAccounts == nil ||
		!item.SourceResolution.Valid() || !item.RuntimeResolution.Valid() {
		return false
	}
	claims := make(map[string]bool)
	for _, id := range item.CustomerAccountIds {
		if !validCRMID(id) || claims[id] {
			return false
		}
		claims[id] = true
	}
	links := make(map[RuntimeAccountID]bool)
	for _, link := range item.RuntimeAccounts {
		id := RuntimeAccountID(link.AccountId)
		if link.AccountId == uuid.Nil || !claims[link.CustomerAccountId] || links[id] {
			return false
		}
		links[id] = true
	}
	return true
}

func validCompanyList(page *wire.CompanyList, query url.Values) bool {
	if !validCompanySource(&page.Source) || !page.Items.IsSpecified() || !page.NextCursor.IsSpecified() {
		return false
	}
	items, err := page.Items.Get()
	if err != nil {
		return !page.Source.Complete && page.NextCursor.IsNull()
	}
	if !page.Source.Complete || items == nil {
		return false
	}
	limit := 25
	if value := query.Get("limit"); value != "" {
		limit, _ = strconv.Atoi(value)
	}
	if len(items) > limit {
		return false
	}
	seen := make(map[CompanyProjectionID]bool)
	for _, item := range items {
		id := CompanyProjectionID(item.Id)
		if seen[id] || !validCompanySummary(item) {
			return false
		}
		seen[id] = true
	}
	if cursor, err := page.NextCursor.Get(); err == nil && (cursor == "" || len(cursor) > 4096) {
		return false
	}
	return true
}

func validCompanyDetail(item *wire.CompanyDetail, target uuid.UUID) bool {
	summary := wire.CompanySummary{Id: item.Id, CrmCompanyId: item.CrmCompanyId, Name: item.Name,
		CustomerAccountIds: item.CustomerAccountIds, RuntimeAccounts: item.RuntimeAccounts,
		SourceResolution: wire.CompanySummarySourceResolution(item.SourceResolution), RuntimeResolution: wire.CompanySummaryRuntimeResolution(item.RuntimeResolution)}
	if item.Id != target || !validCompanySummary(summary) || !validCompanySource(&item.Source) || !item.Source.Complete || item.Contacts == nil || item.UnresolvedRelations == nil {
		return false
	}
	validLink := func(link wire.CompanyContactLink) bool {
		if !validCRMID(link.CrmCompanyId) || !link.CompanyId.IsSpecified() {
			return false
		}
		id, err := link.CompanyId.Get()
		return err != nil || id != uuid.Nil
	}
	contacts := make(map[string]bool)
	for _, contact := range item.Contacts {
		if !validCRMID(contact.Id) || contacts[contact.Id] || contact.Companies == nil {
			return false
		}
		contacts[contact.Id] = true
		for _, link := range contact.Companies {
			if !validLink(link) {
				return false
			}
		}
	}
	for _, link := range item.UnresolvedRelations {
		if !validLink(link) || !link.CompanyId.IsNull() {
			return false
		}
	}
	return true
}

func validCompanyMetadata(item *wire.CompanyWorkflowMetadata) bool {
	if !validCompanySource(&item.Source) || !item.GenerationId.IsSpecified() || !item.Pipelines.IsSpecified() || bool(item.WriteReady) || item.RequiredFieldsState != "unknown" {
		return false
	}
	pipelines, pe := item.Pipelines.Get()
	generation, ge := item.GenerationId.Get()
	if pe != nil || ge != nil {
		return pe != nil && ge != nil && !item.Source.Complete
	}
	if generation == uuid.Nil || pipelines == nil || !item.Source.Complete {
		return false
	}
	seen := make(map[string]bool)
	for _, pipeline := range pipelines {
		if !validCRMID(pipeline.Id) || seen[pipeline.Id] || pipeline.Stages == nil {
			return false
		}
		seen[pipeline.Id] = true
		stages := make(map[string]bool)
		for _, stage := range pipeline.Stages {
			if !validCRMID(stage.Id) || stages[stage.Id] {
				return false
			}
			stages[stage.Id] = true
		}
	}
	return true
}

func validCompanyWorkflow(item *wire.ProductCompanyWorkflow, target uuid.UUID, command intent) bool {
	if ProductID(item.ProductId) != ProductID(target) || target == uuid.Nil || item.Version < 1 || item.Version > MaxVersion || int64(item.Version) < command.Version || bool(item.WriteReady) || !item.Configuration.IsSpecified() {
		return false
	}
	configuration, err := item.Configuration.Get()
	if err != nil {
		return item.Version == 1 && command.Kind == ""
	}
	return item.Version > 1 && configuration.Revision == item.Version-1 && validCRMID(configuration.SourceAccountId) && configuration.BindingRevision != "" && configuration.MetadataGenerationId != uuid.Nil && validCRMID(configuration.PipelineId) && validCRMID(configuration.InitialStageId) && !configuration.ValidatedAt.IsZero()
}
