package accounts

import (
	"encoding/base64"
	"encoding/json"
	"strings"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

func EncodeCursors(cursors map[string]string) *string {
	if len(cursors) == 0 {
		return nil
	}
	raw, err := json.Marshal(cursors)
	if err != nil {
		return nil
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	return &encoded
}

func DecodeCursors(raw string) (map[string]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return map[string]string{}, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, adapter.ErrInvalidArgument
	}
	var cursors map[string]string
	if err := json.Unmarshal(decoded, &cursors); err != nil {
		return nil, adapter.ErrInvalidArgument
	}
	if cursors == nil {
		cursors = map[string]string{}
	}
	return cursors, nil
}
