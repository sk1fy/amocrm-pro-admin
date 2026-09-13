package auth

import (
	"bytes"
	"testing"
)

func TestTokenHashIsSHA256OfRawBytes(t *testing.T) {
	plain, hash, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(hash) != 32 {
		t.Fatalf("hash len = %d", len(hash))
	}
	again, err := HashToken(plain)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(hash, again) {
		t.Fatal("hash mismatch")
	}
	if _, err := HashToken("short"); err == nil {
		t.Fatal("expected invalid token to fail")
	}
}
