package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

const (
	CodeUnauthenticated    = "unauthenticated"
	CodeForbidden          = "forbidden"
	CodeNotFound           = "not_found"
	CodeInvalidArgument    = "invalid_argument"
	CodeConflict           = "conflict"
	CodeRateLimited        = "rate_limited"
	CodeBackendUnavailable = "backend_unavailable"
	CodeBackendTimeout     = "backend_timeout"
	CodeInternal           = "internal"
)

type requestIDKey struct{}

type Error struct {
	Status  int
	Code    string
	Message string
}

func (e Error) Error() string { return e.Message }

func Unauthenticated(message string) Error {
	return Error{Status: http.StatusUnauthorized, Code: CodeUnauthenticated, Message: message}
}

func Forbidden(message string) Error {
	return Error{Status: http.StatusForbidden, Code: CodeForbidden, Message: message}
}

func NotFound(message string) Error {
	return Error{Status: http.StatusNotFound, Code: CodeNotFound, Message: message}
}

func InvalidArgument(message string) Error {
	return Error{Status: http.StatusBadRequest, Code: CodeInvalidArgument, Message: message}
}

func Conflict(message string) Error {
	return Error{Status: http.StatusConflict, Code: CodeConflict, Message: message}
}

func RateLimited(message string) Error {
	return Error{Status: http.StatusTooManyRequests, Code: CodeRateLimited, Message: message}
}

func BackendUnavailable(message string) Error {
	return Error{Status: http.StatusServiceUnavailable, Code: CodeBackendUnavailable, Message: message}
}

func BackendTimeout(message string) Error {
	return Error{Status: http.StatusGatewayTimeout, Code: CodeBackendTimeout, Message: message}
}

func Internal() Error {
	return Error{Status: http.StatusInternalServerError, Code: CodeInternal, Message: "internal error"}
}

type jsonError struct {
	Error jsonErrorFields `json:"error"`
}

type jsonErrorFields struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	RequestID string         `json:"request_id"`
	Details   map[string]any `json:"details,omitempty"`
}

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := uuid.New()
		if incoming, err := uuid.Parse(r.Header.Get("X-Request-ID")); err == nil {
			id = incoming
		}
		w.Header().Set("X-Request-ID", id.String())
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id)))
	})
}

func RequestIDFromContext(ctx context.Context) uuid.UUID {
	if id, ok := ctx.Value(requestIDKey{}).(uuid.UUID); ok {
		return id
	}
	return uuid.Nil
}

func Recover(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if recovered := recover(); recovered != nil {
					logger.Error("http panic",
						"request_id", RequestIDFromContext(r.Context()),
						"method", r.Method,
						"panic", recovered,
						"stack", string(debug.Stack()),
					)
					WriteError(w, r, Internal())
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func AccessLog(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			started := time.Now()
			response := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(response, r)
			route := "unmatched"
			if ctx := chi.RouteContext(r.Context()); ctx != nil && ctx.RoutePattern() != "" {
				route = ctx.RoutePattern()
			}
			logger.Info("http request",
				"request_id", RequestIDFromContext(r.Context()),
				"method", r.Method,
				"route", route,
				"status", response.status,
				"duration", time.Since(started),
			)
		})
	}
}

func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	var api Error
	if !errors.As(err, &api) {
		api = Internal()
	}
	requestID := w.Header().Get("X-Request-ID")
	if requestID == "" && r != nil {
		if id := RequestIDFromContext(r.Context()); id != uuid.Nil {
			requestID = id.String()
		}
	}
	WriteJSON(w, api.Status, jsonError{Error: jsonErrorFields{
		Code:      api.Code,
		Message:   api.Message,
		RequestID: requestID,
	}})
}

func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		return
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
