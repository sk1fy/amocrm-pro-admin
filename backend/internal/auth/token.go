package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

const (
	CookieName    = "admin_session"
	tokenBytes    = 32
	RequestedWith = "admin-ui"
)

func NewToken() (plain string, hash []byte, err error) {
	buf := make([]byte, tokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", nil, fmt.Errorf("generate session token: %w", err)
	}
	sum := sha256.Sum256(buf)
	return base64.RawURLEncoding.EncodeToString(buf), sum[:], nil
}

func HashToken(plain string) ([]byte, error) {
	raw, err := base64.RawURLEncoding.DecodeString(plain)
	if err != nil {
		return nil, fmt.Errorf("decode session token")
	}
	if len(raw) != tokenBytes {
		return nil, fmt.Errorf("decode session token")
	}
	sum := sha256.Sum256(raw)
	return sum[:], nil
}
