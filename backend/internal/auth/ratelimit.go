package auth

import (
	"sync"
	"time"
)

const limiterMaxEntries = 10_000

type window struct {
	minute time.Time
	count  int
}

type Limiter struct {
	mu      sync.Mutex
	limit   int
	entries map[string]*window
}

func NewLimiter(perMinute int) *Limiter {
	if perMinute < 1 {
		perMinute = 1
	}
	return &Limiter{limit: perMinute, entries: make(map[string]*window)}
}

func (l *Limiter) Allow(ip, email string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now().UTC().Truncate(time.Minute)
	okIP := l.hit("ip:"+ip, now)
	okEmail := l.hit("email:"+email, now)
	l.evict(now)
	return okIP && okEmail
}

func (l *Limiter) hit(key string, now time.Time) bool {
	current := l.entries[key]
	if current == nil || current.minute != now {
		l.entries[key] = &window{minute: now, count: 1}
		return true
	}
	if current.count >= l.limit {
		return false
	}
	current.count++
	return true
}

func (l *Limiter) evict(now time.Time) {
	if len(l.entries) <= limiterMaxEntries {
		return
	}
	for key, value := range l.entries {
		if value.minute != now {
			delete(l.entries, key)
		}
		if len(l.entries) <= limiterMaxEntries {
			return
		}
	}
}
