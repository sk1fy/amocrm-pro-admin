package auth

import "testing"

func TestLimiterPerIPAndEmail(t *testing.T) {
	limiter := NewLimiter(2)
	if !limiter.Allow("1.1.1.1", "a@example.invalid") {
		t.Fatal("first attempt")
	}
	if !limiter.Allow("1.1.1.1", "a@example.invalid") {
		t.Fatal("second attempt")
	}
	if limiter.Allow("1.1.1.1", "a@example.invalid") {
		t.Fatal("third attempt should be limited")
	}
	if limiter.Allow("1.1.1.1", "b@example.invalid") {
		t.Fatal("same IP should stay limited")
	}
	if limiter.Allow("2.2.2.2", "a@example.invalid") {
		t.Fatal("same email should stay limited")
	}
	if !limiter.Allow("2.2.2.2", "c@example.invalid") {
		t.Fatal("unrelated pair should pass")
	}
}
