package jsonbody

import (
	"errors"
	"io"
	"strings"
	"testing"
)

func TestDecodeObject(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		limit      int64
		valid      bool
	}{
		{"object", `{"name":"fixture"}`, 64, true},
		{"empty object", `{}`, 64, true},
		{"whitespace", " \n{\"name\":\"fixture\"}\t\r\n", 64, true},
		{"exact limit", `{}`, 2, true},
		{"empty", ``, 64, false},
		{"whitespace only", " \t\n", 64, false},
		{"null", `null`, 64, false},
		{"array", `[]`, 64, false},
		{"string", `"fixture"`, 64, false},
		{"number", `1`, 64, false},
		{"boolean", `true`, 64, false},
		{"unknown field", `{"unexpected":true}`, 64, false},
		{"truncated", `{"name":`, 64, false},
		{"second object", `{} {}`, 64, false},
		{"second scalar", `{} null`, 64, false},
		{"trailing garbage", `{} garbage`, 64, false},
		{"oversized object", `{"name":"fixture"}`, 8, false},
		{"oversized whitespace", `{}` + strings.Repeat(" ", 63), 64, false},
		{"suffix beyond limit", `{}` + strings.Repeat(" ", 62) + `{}`, 64, false},
		{"zero limit", `{}`, 0, false},
		{"negative limit", `{}`, -1, false},
		{"overflow limit", `{}`, 1<<63 - 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var dest struct {
				Name string `json:"name"`
			}
			err := DecodeObject(strings.NewReader(tc.body), tc.limit, &dest)
			if tc.valid {
				if err != nil {
					t.Fatalf("valid object rejected: %v", err)
				}
				if strings.Contains(tc.body, "fixture") && dest.Name != "fixture" {
					t.Fatalf("name = %q", dest.Name)
				}
			} else if !errors.Is(err, ErrInvalid) {
				t.Fatalf("error = %v, want ErrInvalid", err)
			}
		})
	}
}

type brokenReader struct{}

func (brokenReader) Read([]byte) (int, error) {
	return 0, errors.New("sensitive upstream detail")
}

func TestDecodeObjectRejectsReadFailure(t *testing.T) {
	var dest struct{}
	reader := io.MultiReader(strings.NewReader(`{}`), brokenReader{})
	if err := DecodeObject(reader, 64, &dest); err != ErrInvalid {
		t.Fatalf("error = %v, want safe sentinel", err)
	}
	if err := DecodeObject(nil, 64, &dest); err != ErrInvalid {
		t.Fatalf("nil reader error = %v", err)
	}
}

func TestDecodeObjectBoundsReads(t *testing.T) {
	const limit = 64
	reader := strings.NewReader(`{}` + strings.Repeat(" ", 1024))
	before := reader.Len()
	var dest struct{}
	if err := DecodeObject(reader, limit, &dest); err != ErrInvalid {
		t.Fatalf("error = %v", err)
	}
	if consumed := before - reader.Len(); consumed != limit+1 {
		t.Fatalf("read %d bytes, want %d", consumed, limit+1)
	}
}

func TestCanonicalObject(t *testing.T) {
	for _, tc := range []struct{ name, input, want string }{
		{"nested", `{"display_window":{"to":"18:00","from":"09:00"},"revision":1}`, `{"display_window":{"from":"09:00","to":"18:00"},"revision":1}`},
		{"array objects", `{"items":[{"z":1,"a":2},3,1]}`, `{"items":[{"a":2,"z":1},3,1]}`},
		{"precision", `{"revision":9007199254740993,"max":9223372036854775807}`, `{"max":9223372036854775807,"revision":9007199254740993}`},
		{"whitespace", " \n{\"enabled\":true} \n", `{"enabled":true}`},
		{"empty object", `{}`, `{}`},
		{"null", `null`, ""},
		{"array", `[]`, ""},
		{"empty", ``, ""},
		{"scalar", `1`, ""},
		{"trailing object", `{} {}`, ""},
		{"trailing null", `{} null`, ""},
		{"trailing garbage", `{} x`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := CanonicalObject([]byte(tc.input))
			if tc.want == "" {
				if err != ErrInvalid || got != nil {
					t.Fatalf("invalid input: got %q, %v", got, err)
				}
				return
			}
			if err != nil || string(got) != tc.want {
				t.Fatalf("got %q, %v; want %q", got, err, tc.want)
			}
		})
	}
}
