package adapter

import (
	"context"
	"errors"
	"time"

	"golang.org/x/sync/errgroup"
)

type Call[T any] func(ctx context.Context, backend Backend) (Observation[T], error)

type Gathered[T any] struct {
	Items   []Observation[T]
	Sources []SourceStatus
	Invalid error
}

func Capable(backends []Backend, allow func(Capabilities) bool) []Backend {
	out := make([]Backend, 0, len(backends))
	for _, backend := range backends {
		if allow(backend.Capabilities()) {
			out = append(out, backend)
		}
	}
	return out
}

func Gather[T any](ctx context.Context, backends []Backend, call Call[T]) Gathered[T] {
	type row struct {
		code string
		obs  Observation[T]
		err  error
	}
	rows := make([]row, len(backends))
	var group errgroup.Group
	for i, backend := range backends {
		i, backend := i, backend
		group.Go(func() error {
			timeout := backend.Descriptor().Timeout
			if timeout <= 0 {
				timeout = 5 * time.Second
			}
			callCtx, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()
			obs, err := call(callCtx, backend)
			rows[i] = row{code: backend.Descriptor().Code, obs: obs, err: err}
			return nil
		})
	}
	_ = group.Wait()

	out := Gathered[T]{
		Items:   make([]Observation[T], 0, len(backends)),
		Sources: make([]SourceStatus, 0, len(backends)),
	}
	for _, item := range rows {
		if item.err != nil {
			if errors.Is(item.err, ErrNotFound) {
				at := time.Now().UTC()
				out.Sources = append(out.Sources, SourceStatus{
					Backend: item.code, Status: SourceAvailable, ObservedAt: &at,
				})
				continue
			}
			if errors.Is(item.err, ErrInvalidArgument) && out.Invalid == nil {
				out.Invalid = item.err
			}
			out.Sources = append(out.Sources, SourceFromErr(item.code, time.Now().UTC(), item.err))
			continue
		}
		at := item.obs.ObservedAt
		if at.IsZero() {
			at = time.Now().UTC()
		}
		out.Sources = append(out.Sources, SourceStatus{
			Backend:    item.code,
			Status:     SourceAvailable,
			ObservedAt: &at,
		})
		out.Items = append(out.Items, item.obs)
	}
	return out
}
