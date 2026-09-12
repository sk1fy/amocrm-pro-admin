package adapter

import (
	"errors"
)

var (
	ErrUnavailable     = errors.New("backend unavailable")
	ErrTimeout         = errors.New("backend timeout")
	ErrNotFound        = errors.New("not found")
	ErrUnsupported     = errors.New("unsupported")
	ErrInvalidArgument = errors.New("invalid argument")
	ErrConflict        = errors.New("conflict")
)

type Error struct {
	Kind    error
	Backend string
	Message string
}

func (e Error) Error() string {
	if e.Message != "" {
		return e.Message
	}
	if e.Kind != nil {
		return e.Kind.Error()
	}
	return "backend error"
}

func (e Error) Unwrap() error {
	return e.Kind
}

func Unavailable(backend, message string) Error {
	return Error{Kind: ErrUnavailable, Backend: backend, Message: message}
}

func Timeout(backend, message string) Error {
	return Error{Kind: ErrTimeout, Backend: backend, Message: message}
}

func NotFound(backend, message string) Error {
	return Error{Kind: ErrNotFound, Backend: backend, Message: message}
}

func Unsupported(backend, message string) Error {
	return Error{Kind: ErrUnsupported, Backend: backend, Message: message}
}

func InvalidArgument(backend, message string) Error {
	return Error{Kind: ErrInvalidArgument, Backend: backend, Message: message}
}

func SafeMessage(err error) string {
	var api Error
	if errors.As(err, &api) && api.Message != "" {
		return api.Message
	}
	switch {
	case errors.Is(err, ErrTimeout):
		return "backend timed out"
	case errors.Is(err, ErrNotFound):
		return "not found"
	case errors.Is(err, ErrUnsupported):
		return "backend does not support this capability"
	case errors.Is(err, ErrInvalidArgument):
		return "invalid argument"
	case errors.Is(err, ErrConflict):
		return "conflict"
	default:
		return "backend unavailable"
	}
}

func ObsErrorFrom(err error) *ObsError {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, ErrTimeout):
		return &ObsError{Code: ErrorCodeTimeout, Message: SafeMessage(err)}
	case errors.Is(err, ErrUnsupported):
		return &ObsError{Code: ErrorCodeUnsupported, Message: SafeMessage(err)}
	default:
		return &ObsError{Code: ErrorCodeUnavailable, Message: SafeMessage(err)}
	}
}
