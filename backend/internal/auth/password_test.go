package auth

import (
	"strings"
	"testing"
)

func TestHashAndVerify(t *testing.T) {
	hash, err := Hash("correct-horse-battery")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=1,p=4$") {
		t.Fatalf("unexpected phc prefix: %s", hash)
	}
	if !Verify("correct-horse-battery", hash) {
		t.Fatal("expected password to verify")
	}
	if Verify("wrong-password", hash) {
		t.Fatal("wrong password verified")
	}
	if Verify("correct-horse-battery", "not-a-hash") {
		t.Fatal("malformed hash verified")
	}
}

func TestDummyHashVerifiesDummyPasswordOnly(t *testing.T) {
	if Verify("timing-dummy-password-value", dummyPasswordHash()) != true {
		t.Fatal("dummy hash should verify its own password")
	}
	if Verify("other", dummyPasswordHash()) {
		t.Fatal("dummy hash verified unrelated password")
	}
}
