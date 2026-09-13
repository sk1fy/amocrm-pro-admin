package adapter

import (
	"context"
	"time"
)

const (
	StatsPeriod24h = "24h"
	StatsPeriod7d  = "7d"
	StatsPeriod30d = "30d"
)

// StatsBackend is optional. Backends without Stats stay valid adapters.
type StatsBackend interface {
	GetStats(context.Context, Actor, string) (Observation[StatsSnapshot], error)
	ListStatsAccounts(context.Context, Actor, StatsAccountFilter) (Observation[Page[StatsAccount]], error)
}

type StatsSnapshot struct {
	Connected      *int
	Disconnected   *int
	ActiveAccounts *int
	LastUseAt      *time.Time
	JobErrors      *int
	LatencyP50Ms   *int64
	AuthProblems   *int
	SyncProblems   *int
	Period         string
	PeriodStart    time.Time
	PeriodEnd      time.Time
	Connections    []StatsConnectionCount
	Queues         []StatsQueueCount
}

type StatsConnectionCount struct {
	Product string `json:"product"`
	Status  string `json:"status"`
	Count   int    `json:"count"`
}

type StatsQueueCount struct {
	Type   string `json:"type"`
	Status string `json:"status"`
	Count  int    `json:"count"`
}

type StatsAccount struct {
	AccountID       int64
	Domain          string
	InstallationID  string
	IntegrationCode string
	Reason          string
}

type StatsAccountFilter struct {
	Metric  string
	Period  string
	Product string
	Limit   int
	Cursor  string
}

func AsStats(backend Backend) (StatsBackend, bool) {
	if backend == nil || !backend.Capabilities().Stats {
		return nil, false
	}
	stats, ok := backend.(StatsBackend)
	return stats, ok
}

func ValidStatsPeriod(period string) bool {
	switch period {
	case StatsPeriod24h, StatsPeriod7d, StatsPeriod30d:
		return true
	default:
		return false
	}
}
