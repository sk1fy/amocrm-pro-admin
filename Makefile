SHELL := /bin/sh

# Docker-first workflow, same as amocrm-pro. Host Go/Node are optional for
# quick loops; the canonical checks run in containers.
DOCKER ?= docker
COMPOSE ?= $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo docker-compose)
COMPOSE_FILE ?= deploy/docker-compose.yml
GO_VERSION ?= 1.25
GO_IMAGE ?= golang:$(GO_VERSION)-alpine
GOVULNCHECK_VERSION ?= v1.1.4
GOLANGCI_LINT_VERSION ?= v2.13.2
GOLANGCI_LINT_IMAGE ?= golangci/golangci-lint:$(GOLANGCI_LINT_VERSION)-alpine
NODE_IMAGE ?= node:24-alpine
POSTGRES_IMAGE ?= postgres:17-alpine
PLAYWRIGHT_IMAGE ?= mcr.microsoft.com/playwright:v1.63.0-jammy
E2E_PROJECT ?= amocrm-pro-admin-e2e
E2E_EMAIL ?= admin@example.invalid
E2E_PASSWORD ?= correct-horse-battery
# Isolated host ports so the e2e stack can run next to the dev stack.
E2E_POSTGRES_PORT ?= 5434
E2E_FRONTEND_PORT ?= 5174
E2E_HTTP_PORT ?= 8094
E2E_MANAGEMENT_PORT ?= 8095
# The browser joins the Compose network. Loopback-only published ports are
# intentionally not reachable through the Docker host's gateway address.
E2E_BASE_URL ?= http://frontend
E2E_ENV = POSTGRES_PORT=$(E2E_POSTGRES_PORT) FRONTEND_PORT=$(E2E_FRONTEND_PORT) \
	HTTP_PORT=$(E2E_HTTP_PORT) MANAGEMENT_PORT=$(E2E_MANAGEMENT_PORT) \
	ADMIN_PUBLIC_ORIGIN='$(E2E_BASE_URL)'

# Admin DB backups (stage 4.3). restore-check resolves the newest dump inside
# its recipe unless BACKUP_FILE is overridden.
BACKUP_DIR ?= backups
BACKUP_FILE ?=

# Core pilot stack of amocrm-pro (docker-compose.activity.yml). Fixtures and
# local runs target this stack only; production is never a fixture target.
CORE_PILOT_PROJECT ?= amocrm-activity
CORE_PILOT_DB_CONTAINER ?= $(CORE_PILOT_PROJECT)-postgres-1
CORE_PILOT_DB_USER ?= pilot_admin
CORE_PILOT_DB_NAME ?= amocrm_core

UID := $(shell id -u)
GID := $(shell id -g)
DOCKER_GO := $(DOCKER) run --rm --user "$(UID):$(GID)" \
	--env HOME=/tmp --env GOCACHE=/tmp/go-build --env GOMODCACHE=/tmp/go/pkg/mod \
	--volume "$(CURDIR)/backend:/src" --volume "$(CURDIR)/docs:/docs:ro" \
	--workdir /src $(GO_IMAGE)
DOCKER_GOLANGCI := $(DOCKER) run --rm --user "$(UID):$(GID)" \
	--env HOME=/tmp --env GOCACHE=/tmp/go-build --env GOMODCACHE=/tmp/go/pkg/mod \
	--env GOLANGCI_LINT_CACHE=/tmp/golangci \
	--volume "$(CURDIR)/backend:/src" --volume "$(CURDIR)/docs:/docs:ro" \
	--workdir /src $(GOLANGCI_LINT_IMAGE)
DOCKER_NODE := $(DOCKER) run --rm --user "$(UID):$(GID)" \
	--env HOME=/tmp --volume "$(CURDIR)/frontend:/src" --workdir /src $(NODE_IMAGE)

# Content revision of the working tree. Docker's legacy builder does not always
# invalidate COPY layers on file changes, so the value is used as a cache-bust
# layer inside the images.
BUILD_REVISION ?= $(shell { git rev-parse HEAD 2>/dev/null || echo unknown; git status --porcelain 2>/dev/null; git diff HEAD 2>/dev/null; } | { shasum 2>/dev/null || sha1sum; } | cut -c1-12)
export BUILD_REVISION

.DEFAULT_GOAL := help

.PHONY: vulncheck
vulncheck: ## Check reachable Go vulnerabilities against the official database
	$(DOCKER_GO) go run golang.org/x/vuln/cmd/govulncheck@$(GOVULNCHECK_VERSION) ./...

.PHONY: help docs-check config build up down logs migrate lint test integration-test e2e scripts-test check \
	backup-db restore-check fixtures-core fixtures-core-dry-run bench-admin

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "; printf "Usage: make <target>\n\nTargets:\n"} /^[a-zA-Z_-]+:.*## / {printf "  %-22s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------------------------------------------------------------------------
# Documentation (works today)
# ---------------------------------------------------------------------------

docs-check: ## Verify relative Markdown links resolve
	@status=0; \
	for f in $$(find . -name '*.md' -not -path './.git/*' -not -path './frontend/node_modules/*'); do \
		dir=$$(dirname "$$f"); \
		for link in $$(grep -oE '\]\(([^)#]+)(#[^)]*)?\)' "$$f" | sed -E 's/\]\(([^)#]+).*/\1/' | grep -vE '^https?://'); do \
			[ -e "$$dir/$$link" ] || { echo "broken link in $$f: $$link"; status=1; }; \
		done; \
	done; \
	[ $$status -eq 0 ] && echo "docs: links ok"; exit $$status

# ---------------------------------------------------------------------------
# Stack (available after stage 1 part 1.2 creates deploy/docker-compose.yml)
# ---------------------------------------------------------------------------

define require_compose
	@test -f $(COMPOSE_FILE) || { echo "$(COMPOSE_FILE) is not created yet (stage 1, part 1.2)" >&2; exit 1; }
endef

config: ## Validate the resolved Compose configuration
	$(require_compose)
	$(COMPOSE) -f $(COMPOSE_FILE) config --quiet

build: ## Build admin-api, admin-cli and frontend images
	$(require_compose)
	$(COMPOSE) -f $(COMPOSE_FILE) build

up: ## Build and start the local admin stack
	$(require_compose)
	$(COMPOSE) -f $(COMPOSE_FILE) up --build --detach

down: ## Stop the local admin stack
	$(require_compose)
	$(COMPOSE) -f $(COMPOSE_FILE) down --remove-orphans

logs: ## Follow admin-api logs
	$(require_compose)
	$(COMPOSE) -f $(COMPOSE_FILE) logs --follow admin-api

migrate: ## Apply pending admin DB migrations
	$(require_compose)
	$(COMPOSE) -f $(COMPOSE_FILE) run --rm migrate up

# ---------------------------------------------------------------------------
# Checks (each target requires the corresponding source tree to exist)
# ---------------------------------------------------------------------------

lint: ## gofmt/vet/golangci-lint in Docker; eslint + tsc in Docker
	@test -d backend || { echo "backend/ is not created yet (stage 1, part 1.2)" >&2; exit 1; }
	$(DOCKER_GO) sh -ec 'files="$$(gofmt -l .)"; if [ -n "$$files" ]; then printf "%s\n" "$$files"; exit 1; fi; go vet ./...'
	$(DOCKER_GOLANGCI) golangci-lint run --timeout 5m
	@if [ -d frontend ]; then $(DOCKER_NODE) sh -ec 'npm ci --no-audit --no-fund && npm run lint && npx tsc --noEmit'; fi

test: ## Race-enabled Go tests and Vitest in Docker
	@test -d backend || { echo "backend/ is not created yet (stage 1, part 1.2)" >&2; exit 1; }
	$(DOCKER) run --rm \
		--env HOME=/tmp --env GOCACHE=/tmp/go-build --env GOMODCACHE=/tmp/go/pkg/mod \
		--env CGO_ENABLED=1 \
		--volume "$(CURDIR)/backend:/src" --volume "$(CURDIR)/docs:/docs:ro" \
		--workdir /src $(GO_IMAGE) \
		sh -ec 'apk add --no-cache build-base >/dev/null && go test -race -count=1 ./...'
	@if [ -d frontend ]; then $(DOCKER_NODE) sh -ec 'npm ci --no-audit --no-fund && npm test -- --run'; fi

bench-admin: ## Run the large-list account benchmarks (10^4/10^5, no DB, not in check)
	@test -d backend || { echo "backend/ is not created yet (stage 1, part 1.2)" >&2; exit 1; }
	$(DOCKER_GO) go test -run '^$$' -bench 'BenchmarkListAccountsLarge' -benchtime=3x -count=1 ./internal/accounts/

integration-test: ## Migrations up/down and *_integration_test.go against disposable PostgreSQL
	@test -f deploy/docker-compose.test.yml || { echo "deploy/docker-compose.test.yml is not created yet (stage 1, part 1.2)" >&2; exit 1; }
	@set -eu; \
	cleanup() { $(COMPOSE) -p amocrm-pro-admin-test -f deploy/docker-compose.test.yml down --volumes --remove-orphans >/dev/null 2>&1 || true; }; \
	trap cleanup EXIT INT TERM; cleanup; \
	$(COMPOSE) -p amocrm-pro-admin-test -f deploy/docker-compose.test.yml build migrate integration-test; \
	$(COMPOSE) -p amocrm-pro-admin-test -f deploy/docker-compose.test.yml up --detach --wait postgres; \
	$(COMPOSE) -p amocrm-pro-admin-test -f deploy/docker-compose.test.yml run --rm migrate up; \
	$(COMPOSE) -p amocrm-pro-admin-test -f deploy/docker-compose.test.yml run --rm integration-test

e2e: ## Playwright scenarios against the built stack with the fixture adapter
	@test -d frontend/e2e || { echo "frontend/e2e is not created yet (stage 1, part 1.4)" >&2; exit 1; }
	@set -eu; \
	files="-f deploy/docker-compose.yml -f deploy/docker-compose.e2e.yml"; \
	created_networks=""; \
	ensure_network() { if ! $(DOCKER) network inspect "$$1" >/dev/null 2>&1; then $(DOCKER) network create "$$1" >/dev/null; created_networks="$$created_networks $$1"; fi; }; \
	cleanup() { $(E2E_ENV) $(COMPOSE) -p $(E2E_PROJECT) $$files down --volumes --remove-orphans >/dev/null 2>&1 || true; for network in $$created_networks; do $(DOCKER) network rm "$$network" >/dev/null 2>&1 || true; done; }; \
	trap cleanup EXIT INT TERM; \
	ensure_network amocrm-admin-link; \
	ensure_network amocrm-admin-observability; \
	$(E2E_ENV) $(COMPOSE) -p $(E2E_PROJECT) $$files up --build --detach --wait; \
	printf '%s' '$(E2E_PASSWORD)' | $(E2E_ENV) $(COMPOSE) -p $(E2E_PROJECT) $$files --profile tools run --rm -T admin-cli \
	  employee create --email '$(E2E_EMAIL)' --name Admin --role admin --password-stdin \
	  >/dev/null 2>&1 || true; \
	$(DOCKER) run --rm \
	  --network '$(E2E_PROJECT)_admin' \
	  --add-host=host.docker.internal:host-gateway \
	  --env HOME=/tmp \
	  --env E2E_BASE_URL='$(E2E_BASE_URL)' \
	  --env E2E_EMAIL='$(E2E_EMAIL)' \
	  --env E2E_PASSWORD='$(E2E_PASSWORD)' \
	  --volume "$(CURDIR)/frontend:/src:ro" \
	  --workdir /tmp/e2e \
	  $(PLAYWRIGHT_IMAGE) \
	  bash -ec 'cp -a /src/. . && rm -rf node_modules && npm ci --no-audit --no-fund && npx playwright test'

scripts-test: ## Safety tests for backup/restore using command doubles, no database
	sh deploy/scripts/test-backup-restore.sh

check: docs-check lint test integration-test e2e scripts-test vulncheck ## Everything required before merging

# ---------------------------------------------------------------------------
# Admin DB backup and restore verification (stage 4.3)
# ---------------------------------------------------------------------------

backup-db: ## Dump the admin DB to the backup directory (default backups/)
	$(require_compose)
	COMPOSE='$(COMPOSE)' COMPOSE_FILE='$(COMPOSE_FILE)' BACKUP_DIR='$(BACKUP_DIR)' \
		deploy/scripts/backup.sh

restore-check: ## Verify the newest backup against a scratch DB (requires RESTORE_CONFIRM=restore-check)
	@test "$(RESTORE_CONFIRM)" = "restore-check" || { echo "Refusing: set RESTORE_CONFIRM=restore-check (scratch database only)" >&2; exit 1; }
	$(require_compose)
	@backup_file='$(BACKUP_FILE)'; \
	if [ -z "$$backup_file" ]; then \
		backup_file=$$(ls -t "$(BACKUP_DIR)"/*.dump 2>/dev/null | head -n1); \
	fi; \
	if [ -z "$$backup_file" ]; then \
		echo "restore-check: no .dump in $(BACKUP_DIR); pass BACKUP_FILE=<path>" >&2; \
		exit 1; \
	fi; \
	echo "restore-check: using $$backup_file"; \
	COMPOSE='$(COMPOSE)' COMPOSE_FILE='$(COMPOSE_FILE)' RESTORE_CONFIRM='$(RESTORE_CONFIRM)' \
		BACKUP_FILE="$$backup_file" deploy/scripts/restore-check.sh

# ---------------------------------------------------------------------------
# Fixtures for the Core pilot stack (development only, explicitly labelled)
# ---------------------------------------------------------------------------

fixtures-core-dry-run: ## Validate deploy/fixtures/core-installations.sql inside a rolled-back transaction
	@test -f deploy/fixtures/core-installations.sql || { echo "deploy/fixtures/core-installations.sql is missing" >&2; exit 1; }
	@$(DOCKER) exec -i $(CORE_PILOT_DB_CONTAINER) psql -v ON_ERROR_STOP=1 -U $(CORE_PILOT_DB_USER) -d $(CORE_PILOT_DB_NAME) \
		-c 'BEGIN;' -f - -c 'ROLLBACK;' < deploy/fixtures/core-installations.sql >/dev/null && echo "fixtures: dry run ok"

fixtures-core: ## Apply labelled fixture installations to the Core pilot stack (requires FIXTURES_CONFIRM=core-pilot)
	@test "$(FIXTURES_CONFIRM)" = "core-pilot" || { echo "Refusing: set FIXTURES_CONFIRM=core-pilot (development pilot stack only)" >&2; exit 1; }
	@test -f deploy/fixtures/core-installations.sql || { echo "deploy/fixtures/core-installations.sql is missing" >&2; exit 1; }
	$(DOCKER) exec -i $(CORE_PILOT_DB_CONTAINER) psql -v ON_ERROR_STOP=1 -U $(CORE_PILOT_DB_USER) -d $(CORE_PILOT_DB_NAME) \
		--single-transaction -f - < deploy/fixtures/core-installations.sql
