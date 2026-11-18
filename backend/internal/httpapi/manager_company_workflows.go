package httpapi

import (
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
	"time"
)

type managerCompanyListResponse struct {
	*wire.CompanyList
	Sources     []adapter.SourceStatus    `json:"sources"`
	Observation managerCompanyObservation `json:"observation"`
}
type managerCompanyDetailResponse struct {
	*wire.CompanyDetail
	Sources     []adapter.SourceStatus    `json:"sources"`
	Observation managerCompanyObservation `json:"observation"`
}
type managerCompanyMetadataResponse struct {
	*wire.CompanyWorkflowMetadata
	Sources     []adapter.SourceStatus    `json:"sources"`
	Observation managerCompanyObservation `json:"observation"`
}

type managerCompanyObservation struct {
	Source     string              `json:"source"`
	ObservedAt *time.Time          `json:"observed_at"`
	Freshness  string              `json:"freshness"`
	Error      *adapter.ObsError   `json:"error,omitempty"`
	Data       *wire.CompanySource `json:"data"`
	Raw        string              `json:"raw,omitempty"`
}

func companyObservation(source wire.CompanySource) managerCompanyObservation {
	observation := managerCompanyObservation{Source: "platform", Freshness: "unknown", Data: &source}
	if value, err := source.ObservedAt.Get(); err == nil {
		observation.ObservedAt = &value
	}
	switch source.State {
	case "fresh":
		observation.Freshness = "fresh"
	case "stale":
		observation.Freshness = "stale"
	case "error":
		observation.Freshness = "unavailable"
	case "disabled":
		observation.Freshness = "unsupported"
	default:
		observation.Raw = string(source.State)
	}
	if code, err := source.ErrorCode.Get(); err == nil {
		observation.Error = &adapter.ObsError{Code: code, Message: "Источник компаний сообщил ошибку"}
	}
	return observation
}
func companySources(source wire.CompanySource) []adapter.SourceStatus {
	observation := companyObservation(source)
	status := "unknown"
	switch source.State {
	case "fresh":
		status = "available"
	case "stale":
		status = "degraded"
	case "error":
		status = "unavailable"
	}
	result := adapter.SourceStatus{Backend: "platform", Status: status, Error: observation.Error}
	if observation.ObservedAt != nil {
		result.ObservedAt = observation.ObservedAt
	}
	return []adapter.SourceStatus{result}
}
