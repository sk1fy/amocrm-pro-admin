package adapter

import "time"

type Verification struct {
	Classification  string     `json:"classification"`
	ObservedAt      *time.Time `json:"observed_at"`
	Freshness       string     `json:"freshness"`
	FreshForSeconds int64      `json:"fresh_for_seconds"`
	RetryAfter      int64      `json:"retry_after,omitempty"`
	Error           *ObsError  `json:"error,omitempty"`
	Raw             string     `json:"raw,omitempty"`
}

func (v *Verification) Confirmed() bool {
	return v != nil && v.Classification == "verified_ok" && v.Freshness == FreshnessFresh
}
func (v *Verification) Matches(filter string) bool {
	switch filter {
	case "unknown":
		return v == nil || v.Freshness == FreshnessUnknown
	case "stale":
		return v != nil && v.Freshness == FreshnessStale
	case "ok":
		return v.Confirmed()
	case "failed":
		return v != nil && v.Classification != "unknown" && v.Classification != "verified_ok"
	}
	return false
}
func NormalizeVerification(v *Verification) *Verification {
	if v == nil {
		return nil
	}
	out := *v
	switch out.Classification {
	case "verified_ok", "auth_error", "network_error", "rate_limited", "internal_error", "unknown":
	default:
		out.Raw, out.Classification, out.Freshness = out.Classification, "unknown", FreshnessUnknown
	}
	switch out.Freshness {
	case FreshnessFresh, FreshnessStale, FreshnessUnknown, FreshnessUnavailable:
	default:
		out.Freshness = FreshnessUnknown
	}
	if out.ObservedAt == nil {
		out.Classification, out.Freshness = "unknown", FreshnessUnknown
	}
	if out.Error != nil {
		out.Error = &ObsError{Code: out.Classification, Message: "Проверка amoCRM не подтвердила доступ"}
	}
	return &out
}
