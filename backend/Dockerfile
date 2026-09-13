# syntax=docker/dockerfile:1.7

ARG GO_VERSION=1.25
ARG ALPINE_VERSION=3.21

FROM golang:${GO_VERSION}-alpine AS dependencies

ENV CGO_ENABLED=0 \
    GOFLAGS=-mod=readonly

WORKDIR /src

RUN apk add --no-cache ca-certificates git

COPY go.mod go.sum ./

RUN go mod download

FROM dependencies AS source

ARG BUILD_REVISION=unknown

RUN echo "$BUILD_REVISION" > /build-revision

COPY . .

FROM dependencies AS test-base

ARG BUILD_REVISION=unknown

RUN echo "$BUILD_REVISION" > /build-revision

ENV CGO_ENABLED=1

RUN apk add --no-cache build-base

COPY . .

FROM test-base AS integration-test

ENTRYPOINT ["go", "test"]
CMD ["-race", "-count=1", "-v", "./internal/platform/migrations", "./internal/auth", "./internal/employees", "./internal/audit", "./internal/httpapi"]

FROM alpine:${ALPINE_VERSION} AS runtime

ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision=$BUILD_REVISION

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app

WORKDIR /app

USER app

FROM source AS migrate-build

ARG BUILD_REVISION=unknown

RUN go build -trimpath -ldflags="-s -w" -o /out/admin-migrate ./cmd/admin-migrate

FROM runtime AS migrate

COPY --from=migrate-build --chown=app:app /out/admin-migrate /usr/local/bin/admin-migrate
COPY --from=migrate-build --chown=app:app /src/migrations /migrations

ENV MIGRATIONS_DIR=/migrations

ENTRYPOINT ["/usr/local/bin/admin-migrate"]
CMD ["up"]

FROM source AS admin-cli-build

ARG BUILD_REVISION=unknown

RUN go build -trimpath -ldflags="-s -w" -o /out/admin-cli ./cmd/admin-cli

FROM runtime AS admin-cli

COPY --from=admin-cli-build --chown=app:app /out/admin-cli /usr/local/bin/admin-cli

ENTRYPOINT ["/usr/local/bin/admin-cli"]

FROM source AS admin-api-build

ARG BUILD_REVISION=unknown

RUN go build -trimpath -ldflags="-s -w" -o /out/admin-api ./cmd/admin-api

FROM runtime AS admin-api

COPY --from=admin-api-build --chown=app:app /out/admin-api /usr/local/bin/admin-api
COPY --from=admin-api-build --chown=app:app /src/migrations /migrations

ENV MIGRATIONS_DIR=/migrations

EXPOSE 8090 8092

ENTRYPOINT ["/usr/local/bin/admin-api"]
