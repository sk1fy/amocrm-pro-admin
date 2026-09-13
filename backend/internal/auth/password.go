package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/crypto/argon2"
)

const (
	argonTime    = 1
	argonMemory  = 64 * 1024
	argonThreads = 4
	argonKeyLen  = 32
	argonSaltLen = 16
	argonVersion = argon2.Version
)

var (
	dummyOnce sync.Once
	dummyHash string
)

func Hash(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return encodePHC(salt, key, argonTime, argonMemory, argonThreads), nil
}

func Verify(password, encoded string) bool {
	salt, key, timeCost, memory, threads, keyLen, ok := parsePHC(encoded)
	if !ok {
		_, _ = Hash(password)
		return false
	}
	derived := argon2.IDKey([]byte(password), salt, timeCost, memory, threads, keyLen)
	if len(derived) != len(key) {
		return false
	}
	return subtle.ConstantTimeCompare(derived, key) == 1
}

func dummyPasswordHash() string {
	dummyOnce.Do(func() {
		encoded, err := Hash("timing-dummy-password-value")
		if err != nil {
			dummyHash = encodePHC(make([]byte, argonSaltLen), make([]byte, argonKeyLen), argonTime, argonMemory, argonThreads)
			return
		}
		dummyHash = encoded
	})
	return dummyHash
}

func encodePHC(salt, key []byte, timeCost, memory uint32, threads uint8) string {
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argonVersion,
		memory,
		timeCost,
		threads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	)
}

func parsePHC(encoded string) (salt, key []byte, timeCost, memory uint32, threads uint8, keyLen uint32, ok bool) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || !strings.HasPrefix(parts[2], "v=") {
		return nil, nil, 0, 0, 0, 0, false
	}
	version, err := strconv.Atoi(strings.TrimPrefix(parts[2], "v="))
	if err != nil || version != argonVersion {
		return nil, nil, 0, 0, 0, 0, false
	}
	var m, t, p int
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return nil, nil, 0, 0, 0, 0, false
	}
	if m <= 0 || t <= 0 || p <= 0 || p > 255 || m > math.MaxUint32 || t > math.MaxUint32 {
		return nil, nil, 0, 0, 0, 0, false
	}
	salt, err = base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) == 0 {
		return nil, nil, 0, 0, 0, 0, false
	}
	key, err = base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(key) == 0 || len(key) > math.MaxUint32 {
		return nil, nil, 0, 0, 0, 0, false
	}
	return salt, key, uint32(t), uint32(m), uint8(p), uint32(len(key)), true
}
