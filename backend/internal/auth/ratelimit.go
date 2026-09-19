package auth

import (
	"crypto/sha256"
	"sync"
	"time"
)

const limiterMaxEntries = 10_000

// Fixed-size hashes bound memory even for attacker-controlled email lengths.
type limiterKey [sha256.Size]byte

type Limiter struct {
	mu      sync.Mutex
	limit   int
	minute  time.Time
	now     func() time.Time
	entries map[limiterKey]int
}

func NewLimiter(perMinute int) *Limiter {
	if perMinute < 1 {
		perMinute = 1
	}
	return &Limiter{limit: perMinute, now: time.Now, entries: make(map[limiterKey]int)}
}

func (l *Limiter) Allow(ip, email string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now().UTC().Truncate(time.Minute)
	if now != l.minute {
		// All counters share a fixed window. Clear at most once per window,
		// never scan the table on a denied request in the same window.
		clear(l.entries)
		l.minute = now
	}
	if !l.hit(sha256.Sum256([]byte("ip:" + ip))) {
		return false
	}
	return l.hit(sha256.Sum256([]byte("email:" + email)))
}

func (l *Limiter) hit(key limiterKey) bool {
	count, exists := l.entries[key]
	if count >= l.limit || (!exists && len(l.entries) >= limiterMaxEntries) {
		// Fail closed at capacity; evicting live counters would reset limits.
		return false
	}
	l.entries[key] = count + 1
	return true
}
