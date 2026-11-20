package managerplatform

import (
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/oapi-codegen/nullable"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

// These identifiers belong to different identity spaces, even when encoded as UUIDs.
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
	if ProductID(item.ProductId) != ProductID(target) || target == uuid.Nil || bool(item.WriteReady) {
		return false
	}
	return validWorkflowConfiguration(item.Version, item.Configuration, command)
}

func validWorkflowConfiguration(version int, value nullable.Nullable[wire.CompanyWorkflowConfiguration], command intent) bool {
	if version < 1 || version > MaxVersion || int64(version) < command.Version || !value.IsSpecified() {
		return false
	}
	configuration, err := value.Get()
	if err != nil {
		return version == 1 && command.Kind == ""
	}
	return version > 1 && configuration.Revision == version-1 && validCRMID(configuration.SourceAccountId) && configuration.BindingRevision != "" && configuration.MetadataGenerationId != uuid.Nil && validCRMID(configuration.PipelineId) && validCRMID(configuration.InitialStageId) && !configuration.ValidatedAt.IsZero()
}
