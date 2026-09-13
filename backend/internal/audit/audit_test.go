package audit

import "testing"

func TestValidateMetadataRejectsForbiddenKeys(t *testing.T) {
	tests := []struct {
		name     string
		metadata map[string]any
		wantErr  bool
	}{
		{name: "safe", metadata: map[string]any{"changed": []any{"role"}, "from": map[string]any{"role": "viewer"}}},
		{name: "password", metadata: map[string]any{"password": "nope"}, wantErr: true},
		{name: "nested token", metadata: map[string]any{"extra": map[string]any{"session_token": "abc"}}, wantErr: true},
		{name: "ciphertext", metadata: map[string]any{"client_secret_ciphertext": "x"}, wantErr: true},
		{name: "key_hash", metadata: map[string]any{"webhook_key_hash": "x"}, wantErr: true},
		{name: "secret", metadata: map[string]any{"api_secret": "x"}, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateMetadata(test.metadata)
			if test.wantErr && err == nil {
				t.Fatal("expected forbidden metadata")
			}
			if !test.wantErr && err != nil {
				t.Fatal(err)
			}
		})
	}
}
