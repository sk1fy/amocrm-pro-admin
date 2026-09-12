package adapter

import (
	"time"

	"github.com/google/uuid"
)

func EmployeeActor(id uuid.UUID) Actor {
	return Actor{Value: "employee:" + id.String()}
}

func Fresh[T any](source string, at time.Time, data T) Observation[T] {
	return Observation[T]{
		Source:     source,
		ObservedAt: at.UTC(),
		Freshness:  FreshnessFresh,
		Data:       &data,
	}
}

func UnavailableObs[T any](source string, at time.Time, err error) Observation[T] {
	if at.IsZero() {
		at = time.Now().UTC()
	}
	return Observation[T]{
		Source:     source,
		ObservedAt: at.UTC(),
		Freshness:  FreshnessUnavailable,
		Error:      ObsErrorFrom(err),
	}
}

func UnknownObs[T any](source string, at time.Time, code, message string) Observation[T] {
	if at.IsZero() {
		at = time.Now().UTC()
	}
	return Observation[T]{
		Source:     source,
		ObservedAt: at.UTC(),
		Freshness:  FreshnessUnknown,
		Error:      &ObsError{Code: code, Message: message},
	}
}

func SourceFromErr(backend string, at time.Time, err error) SourceStatus {
	observed := at.UTC()
	if err != nil {
		return SourceStatus{
			Backend:    backend,
			Status:     SourceUnavailable,
			ObservedAt: &observed,
			Error:      ObsErrorFrom(err),
		}
	}
	return SourceStatus{
		Backend:    backend,
		Status:     SourceAvailable,
		ObservedAt: &observed,
	}
}
