package auth

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestLimiterDeniedIPDoesNotAllocateEmails(t *testing.T) {
	l := NewLimiter(1)
	l.now = func() time.Time { return time.Unix(120, 0) }
	for i := 0; i <= limiterMaxEntries; i++ {
		allowed := l.Allow("same-ip", fmt.Sprintf("%d@example.invalid", i))
		if allowed != (i == 0) {
			t.Fatalf("attempt %d allowed=%t", i, allowed)
		}
	}
	if len(l.entries) != 2 {
		t.Fatalf("denied IP allocated entries: %d", len(l.entries))
	}
}

func TestLimiterCapacityConcurrentAndWindowRollover(t *testing.T) {
	l := NewLimiter(2)
	now := time.Unix(120, 0)
	l.now = func() time.Time { return now }
	var wg sync.WaitGroup
	for worker := 0; worker < 8; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < limiterMaxEntries; i++ {
				key := fmt.Sprintf("%d-%d", worker, i)
				l.Allow(key, key+"@example.invalid")
			}
		}()
	}
	wg.Wait()
	if len(l.entries) != limiterMaxEntries || l.Allow("new-ip", "new-email") {
		t.Fatalf("capacity not enforced: %d", len(l.entries))
	}
	now = now.Add(time.Minute)
	for attempt := 0; attempt < 3; attempt++ {
		if allowed := l.Allow("new-ip", "new-email"); allowed != (attempt < 2) {
			t.Fatalf("rollover attempt %d allowed=%t", attempt, allowed)
		}
	}
	if len(l.entries) != 2 {
		t.Fatalf("stale entries retained: %d", len(l.entries))
	}
}
