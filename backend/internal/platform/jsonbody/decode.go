// Package jsonbody validates JSON object request bodies without exposing
// payloads or parser details in errors.
package jsonbody

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

var ErrInvalid = errors.New("invalid request body")

// DecodeObject accepts exactly one JSON object, with optional whitespace.
// It reads at most limit+1 bytes so a valid prefix cannot hide an oversized
// body. The caller owns and closes reader.
func DecodeObject(reader io.Reader, limit int64, dest any) error {
	if reader == nil || limit <= 0 || limit == 1<<63-1 {
		return ErrInvalid
	}
	raw, err := io.ReadAll(io.LimitReader(reader, limit+1))
	defer clear(raw)
	if err != nil || int64(len(raw)) > limit {
		return ErrInvalid
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '{' {
		return ErrInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		return ErrInvalid
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return ErrInvalid
	}
	return nil
}

// CanonicalObject sorts object properties recursively while preserving array
// order and number tokens. It does not validate command-specific fields.
func CanonicalObject(raw []byte) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil || value == nil {
		return nil, ErrInvalid
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, ErrInvalid
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return nil, ErrInvalid
	}
	return canonical, nil
}
