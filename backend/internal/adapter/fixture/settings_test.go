package fixture

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

func TestActivityConfigureConflictReturnsCurrentSettings(t *testing.T) {
	fx := Demo("core")
	id := installationID(1)
	got, err := fx.GetActivitySettings(context.Background(), adapter.Actor{}, id)
	if err != nil || got.Data == nil || got.Data.RetentionDays != 7 || got.Data.UpdatedAt == nil {
		t.Fatalf("settings=%+v err=%v", got.Data, err)
	}
	payload, _ := json.Marshal(map[string]any{
		"initial_days": 2, "retention_days": 14, "expected_updated_at": int64(1),
	})
	result, err := fx.ExecuteCommand(context.Background(), adapter.Actor{}, "conflict-key", adapter.CommandRequest{
		TargetType: "installation", TargetID: id, Command: "activity-configure", Payload: payload,
	})
	if !errors.Is(err, adapter.ErrConflict) {
		t.Fatalf("err=%v", err)
	}
	if result.Result["retention_days"] != float64(7) && result.Result["retention_days"] != 7 {
		t.Fatalf("current=%v", result.Result)
	}
	after, err := fx.GetActivitySettings(context.Background(), adapter.Actor{}, id)
	if err != nil || after.Data.RetentionDays != 7 {
		t.Fatalf("overwritten: %+v %v", after.Data, err)
	}
}

func TestLeadStatusStaleRevisionConflicts(t *testing.T) {
	fx := Demo("core")
	id := installationID(1)
	stale := int64(0)
	payload, _ := json.Marshal(map[string]any{
		"source_pipeline_id": 1, "source_status_id": 2, "target_pipeline_id": 3, "target_status_id": 4,
		"enabled": true, "expected_revision": stale,
	})
	_, err := fx.ExecuteCommand(context.Background(), adapter.Actor{}, "rule-conflict", adapter.CommandRequest{
		TargetType: "installation", TargetID: id, Command: "lead-status-configure", Payload: payload,
	})
	if !errors.Is(err, adapter.ErrConflict) {
		t.Fatalf("err=%v", err)
	}
}

func TestActivitySyncPendingThenSucceeded(t *testing.T) {
	fx := Demo("core")
	payload, _ := json.Marshal(map[string]any{"kind": "sync"})
	result, err := fx.ExecuteCommand(context.Background(), adapter.Actor{}, "sync-key", adapter.CommandRequest{
		TargetType: "installation", TargetID: installationID(1), Command: "activity-sync", Payload: payload,
	})
	if err != nil || result.State != "pending" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	got, err := fx.GetCommand(context.Background(), adapter.Actor{}, "sync-key")
	if err != nil || got.State != "succeeded" {
		t.Fatalf("poll=%+v err=%v", got, err)
	}
}

func TestStatsNullVersusZero(t *testing.T) {
	fx := Demo("core")
	obs, err := fx.GetStats(context.Background(), adapter.Actor{}, adapter.StatsPeriod24h)
	if err != nil || obs.Data == nil {
		t.Fatalf("stats err=%v", err)
	}
	if obs.Data.Disconnected == nil || *obs.Data.Disconnected != 0 {
		t.Fatalf("disconnected=%v", obs.Data.Disconnected)
	}
	if obs.Data.LatencyP50Ms != nil {
		t.Fatalf("latency should be null, got %v", *obs.Data.LatencyP50Ms)
	}
	if obs.Data.SyncProblems == nil || *obs.Data.SyncProblems != 0 {
		t.Fatalf("sync_problems=%v", obs.Data.SyncProblems)
	}
}

func TestUnknownSyncStateIsNotIdle(t *testing.T) {
	fx := Demo("core")
	obs, err := fx.GetActivitySyncStatus(context.Background(), adapter.Actor{}, installationID(8))
	if err != nil || obs.Data == nil {
		t.Fatalf("status err=%v", err)
	}
	if obs.Data.State.Canonical != adapter.StateUnknown || obs.Data.State.Raw == "" {
		t.Fatalf("state=%+v", obs.Data.State)
	}
	if obs.Data.State.Canonical == adapter.SyncIdle {
		t.Fatal("unknown must not become idle")
	}
}
