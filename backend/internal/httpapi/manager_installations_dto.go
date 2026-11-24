package httpapi

import (
	"time"

	"github.com/google/uuid"
	"github.com/oapi-codegen/nullable"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

type managerInstallationDTO struct {
	InstalledBy        *string                             `json:"installed_by,omitempty"`
	ID                 uuid.UUID                           `json:"id"`
	AccountID          uuid.UUID                           `json:"account_id"`
	AmoAccountID       string                              `json:"amo_account_id"`
	ProductID          uuid.UUID                           `json:"product_id"`
	ProductCode        string                              `json:"product_code"`
	ProductName        string                              `json:"product_name"`
	ProductLine        string                              `json:"product_line,omitempty"`
	AccountDomain      *string                             `json:"account_domain,omitempty"`
	AccountName        *string                             `json:"account_name,omitempty"`
	AccountClass       *string                             `json:"account_classification,omitempty"`
	AccountZone        *string                             `json:"account_time_zone,omitempty"`
	CoreInstallationID uuid.UUID                           `json:"core_installation_id"`
	Generation         int                                 `json:"generation"`
	Kind               string                              `json:"kind"`
	InstalledAt        time.Time                           `json:"installed_at"`
	RemovedAt          *time.Time                          `json:"removed_at"`
	LastLifecycleEvent string                              `json:"last_lifecycle_event"`
	Lifecycle          string                              `json:"lifecycle"`
	Authorization      string                              `json:"authorization"`
	ActivationStatus   string                              `json:"activation_status"`
	Review             managerInstallationReviewDTO        `json:"review"`
	CRMWorkflow        string                              `json:"crm_workflow"`
	Contact            *wire.InstallationActivationContact `json:"contact,omitempty"`
	Deal               *wire.InstallationDeal              `json:"deal,omitempty"`
	Access             managerInstallationAccessDTO        `json:"access"`
	Version            int                                 `json:"version"`
}

type managerInstallationReviewDTO struct {
	Reviewed       bool       `json:"reviewed"`
	ReviewedBy     *uuid.UUID `json:"reviewed_by,omitempty"`
	ReviewedAt     *time.Time `json:"reviewed_at,omitempty"`
	ReviewedByName string     `json:"reviewed_by_name,omitempty"`
}

type managerInstallationAccessDTO struct {
	AccountID          uuid.UUID  `json:"account_id"`
	ProductID          uuid.UUID  `json:"product_id"`
	Active             bool       `json:"active"`
	ValidUntil         *time.Time `json:"valid_until"`
	Source             string     `json:"source"`
	ReasonCodes        []string   `json:"reason_codes"`
	OwnUntil           *time.Time `json:"own_until"`
	EntitlementVersion int        `json:"entitlement_version"`
	ComputedAt         time.Time  `json:"computed_at"`
}

type managerInstallationSummaryDTO struct {
	Total      int `json:"total"`
	Reviewed   int `json:"reviewed"`
	Unreviewed int `json:"unreviewed"`
}

type managerInstallationListDTO struct {
	Items       []managerInstallationDTO       `json:"items"`
	NextCursor  *string                        `json:"next_cursor"`
	SnapshotAt  time.Time                      `json:"snapshot_at"`
	QueryHash   string                         `json:"query_hash"`
	Summary     managerInstallationSummaryDTO  `json:"summary"`
	QueueCounts *managerInstallationSummaryDTO `json:"queue_counts,omitempty"`
	Sources     []adapter.SourceStatus         `json:"sources"`
}

func toManagerInstallationListDTO(page *wire.InstallationList) managerInstallationListDTO {
	items := make([]managerInstallationDTO, len(page.Items))
	for i := range page.Items {
		items[i] = toManagerInstallationDTO(&page.Items[i])
	}
	snapshotAt := page.SnapshotAt.UTC()
	result := managerInstallationListDTO{
		Items: items, NextCursor: nullablePointer(page.NextCursor), SnapshotAt: snapshotAt, QueryHash: page.QueryHash,
		Summary: managerInstallationSummaryDTO{Total: page.Summary.Total, Reviewed: page.Summary.Reviewed, Unreviewed: page.Summary.Unreviewed},
		Sources: []adapter.SourceStatus{{Backend: "platform", Status: "available", ObservedAt: &snapshotAt}},
	}
	if counts := page.QueueCounts; counts != nil {
		result.QueueCounts = &managerInstallationSummaryDTO{Total: counts.Total, Reviewed: counts.Reviewed, Unreviewed: counts.Unreviewed}
	}
	return result
}

func toManagerInstallationDTO(row *wire.Installation) managerInstallationDTO {
	review := row.Review
	access := row.Access
	var line string
	if row.ProductLine != nil {
		line = string(*row.ProductLine)
	}
	return managerInstallationDTO{
		ID: row.Id, AccountID: row.AccountId, AmoAccountID: string(row.AmoAccountId),
		ProductID: row.ProductId, ProductCode: string(row.ProductCode), ProductName: row.ProductName, ProductLine: line,
		AccountDomain: row.AccountDomain, AccountName: row.AccountName,
		AccountClass: row.AccountClassification, AccountZone: row.AccountTimeZone,
		CoreInstallationID: row.CoreInstallationId, Generation: row.Generation, Kind: string(row.Kind),
		InstalledBy: row.InstalledBy, InstalledAt: row.InstalledAt.UTC(), RemovedAt: utcPointer(nullablePointer(row.RemovedAt)),
		LastLifecycleEvent: string(row.LastLifecycleEvent), Lifecycle: string(row.Lifecycle),
		Authorization: string(row.Authorization), ActivationStatus: string(row.ActivationStatus),
		Review:      managerInstallationReviewDTO{Reviewed: review.Reviewed, ReviewedBy: review.ReviewedBy, ReviewedAt: utcPointer(review.ReviewedAt)},
		CRMWorkflow: string(row.CrmWorkflow), Version: row.Version, Contact: row.Contact, Deal: row.Deal,
		Access: managerInstallationAccessDTO{
			AccountID: access.AccountId, ProductID: access.ProductId, Active: access.Active, Source: string(access.Source),
			ValidUntil: utcPointer(nullablePointer(access.ValidUntil)), ReasonCodes: access.ReasonCodes,
			OwnUntil: utcPointer(nullablePointer(access.OwnUntil)), EntitlementVersion: access.EntitlementVersion, ComputedAt: access.ComputedAt.UTC(),
		},
	}
}

func nullablePointer[T any](value nullable.Nullable[T]) *T {
	v, err := value.Get()
	if err != nil {
		return nil
	}
	return &v
}

func utcPointer(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	return new(t.UTC())
}
