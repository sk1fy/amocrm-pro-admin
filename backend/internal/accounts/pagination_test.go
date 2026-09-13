package accounts

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
	"github.com/sk1fy/amocrm-pro-admin/internal/adapter/fixture"
)

func TestUnavailableTotalsWithoutPostFilter(t *testing.T) {
	for _, backends := range [][]adapter.Backend{{fixture.Unavailable("core")}, {fixture.Unavailable("core"), fixture.Demo("other")}} {
		result, err := New(backends, nil).ListAccounts(t.Context(), adapter.Actor{}, ListFilter{})
		if err != nil {
			t.Fatal(err)
		}
		if result.Total != nil {
			t.Fatalf("unavailable source must withhold total, got %d", *result.Total)
		}
	}
}

func TestProductFilterUsesGrantedService(t *testing.T) {
	svc := New([]adapter.Backend{fixture.Demo("core")}, nil)
	for _, product := range []string{"lead-status", "activity"} {
		result, err := svc.ListAccounts(t.Context(), adapter.Actor{}, ListFilter{Product: product})
		if err != nil || len(result.Items) == 0 {
			t.Fatalf("%s: items=%d err=%v", product, len(result.Items), err)
		}
		for _, item := range result.Items {
			found := false
			for _, c := range item.Connections {
				for _, g := range c.Grants {
					found = found || (g.Service == product && g.State.Canonical == adapter.GrantGranted)
				}
			}
			if !found {
				t.Fatalf("wrong product match %+v", item)
			}
		}
	}
}

func TestAccountHistoryAndJobsTraverseEverySource(t *testing.T) {
	now := time.Now().UTC()
	data := fixture.Data{Accounts: []adapter.Account{{AccountID: 1, Connections: []adapter.ConnectionSummary{{ID: "a"}, {ID: "b"}}}}, ConnectionAudit: map[string][]adapter.AuditEntry{}, ConnectionJobs: map[string][]adapter.Job{}}
	for _, conn := range []string{"a", "b"} {
		for i := 1; i <= 61; i++ {
			id := fmt.Sprintf("%s-%03d", conn, i)
			// Equal timestamps exercise deterministic native ordering across page edges.
			at := now.Add(-time.Duration(i/4) * time.Minute)
			data.ConnectionAudit[conn] = append(data.ConnectionAudit[conn], adapter.AuditEntry{ID: int64(i), Action: "update", ObjectID: &id, CreatedAt: at})
			data.ConnectionJobs[conn] = append(data.ConnectionJobs[conn], adapter.Job{ID: id, UpdatedAt: at, Status: adapter.MapJobStatus("failed")})
		}
	}
	svc := New([]adapter.Backend{fixture.New(fixture.Options{Code: "core", Data: data})}, nil)
	for _, kind := range []string{"history", "jobs"} {
		t.Run(kind, func(t *testing.T) {
			cursor := ""
			seen := map[string]bool{}
			for page := 0; page < 30; page++ {
				var keys []string
				var next *string
				if kind == "history" {
					result, err := svc.History(t.Context(), adapter.Actor{}, 1, 7, cursor)
					if err != nil {
						t.Fatal(err)
					}
					next = result.NextCursor
					for _, item := range result.Items {
						keys = append(keys, *item.ObjectID)
					}
				} else {
					result, err := svc.Jobs(t.Context(), adapter.Actor{}, 1, adapter.JobFilter{Limit: 7, Cursor: cursor, Status: "failed"})
					if err != nil {
						t.Fatal(err)
					}
					next = result.NextCursor
					for _, item := range result.Items {
						keys = append(keys, item.Job.ID)
						if item.Backend != "core" {
							t.Fatal("missing backend")
						}
					}
				}
				if len(keys) > 7 {
					t.Fatal("merged page exceeded limit")
				}
				for _, key := range keys {
					if seen[key] {
						t.Fatalf("duplicate %s", key)
					}
					seen[key] = true
				}
				if next == nil {
					break
				}
				cursor = *next
			}
			if len(seen) != 122 {
				t.Fatalf("lost records: got %d want122", len(seen))
			}
		})
	}
}

func TestMergedCursorDoesNotReplayAnExhaustedStream(t *testing.T) {
	streams := []pageStream[int]{}
	for _, ids := range [][]int{{9}, {8, 7, 6, 5}} {
		streamID := fmt.Sprint(ids[0])
		streams = append(streams, pageStream[int]{ID: streamID, Backend: streamID, Read: func(_ context.Context, limit int, cursor string) (streamPage[int], error) {
			page := streamPage[int]{}
			started := cursor == ""
			for _, id := range ids {
				if !started {
					if fmt.Sprint(id) == cursor {
						started = true
					}
					continue
				}
				page.Items = append(page.Items, positioned[int]{Value: id, At: time.Unix(int64(id), 0), Cursor: fmt.Sprint(id)})
			}
			if len(page.Items) > limit {
				page.More = true
				page.Items = page.Items[:limit]
			}
			return page, nil
		}})
	}
	first, next, _, err := mergePages(t.Context(), "test", "", 2, streams, nil)
	if err != nil || len(first) != 2 || next == nil {
		t.Fatalf("first=%v %v", first, err)
	}
	second, _, _, err := mergePages(t.Context(), "test", *next, 2, streams, nil)
	if err != nil || len(second) != 2 || second[0] != 7 || second[1] != 6 {
		t.Fatalf("second=%v %v", second, err)
	}
	if _, _, _, err := mergePages(t.Context(), "different", *next, 2, streams, nil); err == nil {
		t.Fatal("cross-scope cursor accepted")
	}
}

func TestMergedCursorRejectsMissingVersionAndScope(t *testing.T) {
	for _, raw := range []string{"not-base64", "e30", "bnVsbA"} {
		if _, _, _, err := mergePages[int](t.Context(), "history:1", raw, 25, nil, nil); err == nil {
			t.Fatalf("accepted malformed cursor %q", raw)
		}
	}
}

func TestMergedPaginationRecoversFailedStreamWithoutLosingItsPosition(t *testing.T) {
	failing := false
	streams := []pageStream[int]{}
	for _, ids := range [][]int{{6, 4, 2}, {5, 3, 1}} {
		streamID := fmt.Sprint(ids[0])
		streams = append(streams, pageStream[int]{ID: streamID, Backend: streamID, Read: func(_ context.Context, limit int, cursor string) (streamPage[int], error) {
			if streamID == "5" && failing {
				return streamPage[int]{}, adapter.Timeout(streamID, "temporary timeout")
			}
			page := streamPage[int]{}
			started := cursor == ""
			for _, id := range ids {
				if !started {
					if fmt.Sprint(id) == cursor {
						started = true
					}
					continue
				}
				page.Items = append(page.Items, positioned[int]{Value: id, At: time.Unix(int64(id), 0), Cursor: fmt.Sprint(id)})
			}
			if len(page.Items) > limit {
				page.More = true
				page.Items = page.Items[:limit]
			}
			return page, nil
		}})
	}
	first, next, _, err := mergePages(t.Context(), "recovery", "", 2, streams, nil)
	if err != nil || fmt.Sprint(first) != "[6 5]" || next == nil {
		t.Fatalf("first=%v err=%v", first, err)
	}
	failing = true
	second, next, sources, err := mergePages(t.Context(), "recovery", *next, 2, streams, nil)
	if err != nil || fmt.Sprint(second) != "[4 2]" || next == nil || !sourceUnavailable(sources) {
		t.Fatalf("second=%v err=%v sources=%v", second, err, sources)
	}
	failing = false
	third, next, _, err := mergePages(t.Context(), "recovery", *next, 2, streams, nil)
	if err != nil || fmt.Sprint(third) != "[3 1]" || next != nil {
		t.Fatalf("third=%v err=%v next=%v", third, err, next)
	}
}
