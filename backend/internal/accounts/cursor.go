package accounts

import (
	"encoding/base64"
	"encoding/json"
	"strings"

	"github.com/sk1fy/amocrm-pro-admin/internal/adapter"
)

// exhaustedCursor marks a source whose last page has already been returned.
// Native cursors are base64url or numeric, so the value cannot collide.
const exhaustedCursor = "!end"

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

// PendingBackends drops the sources a continuation cursor has finished. In a
// non-empty cursor a missing source is finished too: earlier cursors omitted
// exhausted sources instead of marking them.
func PendingBackends(backends []adapter.Backend, cursors map[string]string) []adapter.Backend {
	if len(cursors) == 0 {
		return backends
	}
	pending := make([]adapter.Backend, 0, len(backends))
	for _, backend := range backends {
		position, ok := cursors[backend.Descriptor().Code]
		if ok && position != exhaustedCursor {
			pending = append(pending, backend)
		}
	}
	return pending
}

// Continuation builds the next multi-source cursor. A source that answered
// moves to its next page or is marked exhausted; a source that did not answer
// keeps its previous position so the next request retries it; a finished
// source stays finished.
type Continuation struct {
	previous map[string]string
	next     map[string]string
}

func NewContinuation(previous map[string]string) *Continuation {
	next := map[string]string{}
	for backend, position := range previous {
		if position == exhaustedCursor {
			next[backend] = exhaustedCursor
		}
	}
	return &Continuation{previous: previous, next: next}
}

// Advance records the page a source returned.
func (c *Continuation) Advance(backend string, nextCursor *string) {
	if nextCursor != nil && *nextCursor != "" {
		c.next[backend] = *nextCursor
		return
	}
	c.next[backend] = exhaustedCursor
}

// Encode keeps the previous position of every queried source that did not
// answer. It returns nil once every source is exhausted, or when no source
// has moved past its first page (the next request would repeat this one).
func (c *Continuation) Encode(queried []adapter.Backend) *string {
	for _, backend := range queried {
		code := backend.Descriptor().Code
		if _, ok := c.next[code]; !ok {
			c.next[code] = c.previous[code]
		}
	}
	finished, started := true, false
	for _, position := range c.next {
		if position != exhaustedCursor {
			finished = false
		}
		if position != "" {
			started = true
		}
	}
	if finished || !started {
		return nil
	}
	return EncodeCursors(c.next)
}
