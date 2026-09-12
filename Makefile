SHELL := /bin/sh

# Docker-first workflow, same as amocrm-pro. Host Go/Node are optional for
# quick loops; the canonical checks run in containers.
DOCKER ?= docker
COMPOSE ?= docker compose
COMPOSE_FILE ?= deploy/docker-compose.yml
GO_VERSION ?= 1.25
GO_IMAGE ?= golang:$(GO_VERSION)-alpine
NODE_IMAGE ?= node:24-alpine
POSTGRES_IMAGE ?= postgres:17-alpine

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
	--volume "$(CURDIR)/backend:/src" --workdir /src $(GO_IMAGE)
DOCKER_NODE := $(DOCKER) run --rm --user "$(UID):$(GID)" \
	--env HOME=/tmp --volume "$(CURDIR)/frontend:/src" --workdir /src $(NODE_IMAGE)

.DEFAULT_GOAL := help

.PHONY: help docs-check config build up down logs migrate lint test integration-test e2e check \
	fixtures-core fixtures-core-dry-run

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

config: $(COMPOSE_FILE) ## Validate the resolved Compose configuration
	$(COMPOSE) -f $(COMPOSE_FILE) config --quiet

build: $(COMPOSE_FILE) ## Build admin-api, admin-cli and frontend images
	$(COMPOSE) -f $(COMPOSE_FILE) build

up: $(COMPOSE_FILE) ## Build and start the local admin stack
	$(COMPOSE) -f $(COMPOSE_FILE) up --build --detach

down: $(COMPOSE_FILE) ## Stop the local admin stack
	$(COMPOSE) -f $(COMPOSE_FILE) down --remove-orphans

logs: $(COMPOSE_FILE) ## Follow admin-api logs
	$(COMPOSE) -f $(COMPOSE_FILE) logs --follow admin-api

migrate: $(COMPOSE_FILE) ## Apply pending admin DB migrations
	$(COMPOSE) -f $(COMPOSE_FILE) run --rm migrate up

# ---------------------------------------------------------------------------
# Checks (each target requires the corresponding source tree to exist)
# ---------------------------------------------------------------------------

lint: ## gofmt/vet in Docker; eslint + tsc in Docker
	@test -d backend || { echo "backend/ is not created yet (stage 1, part 1.2)" >&2; exit 1; }
	$(DOCKER_GO) sh -ec 'files="$$(gofmt -l .)"; if [ -n "$$files" ]; then printf "%s\n" "$$files"; exit 1; fi; go vet ./...'
	@if [ -d frontend ]; then $(DOCKER_NODE) sh -ec 'npm ci --no-audit --no-fund && npm run lint && npx tsc --noEmit'; fi

test: ## Race-enabled Go tests and Vitest in Docker
	@test -d backend || { echo "backend/ is not created yet (stage 1, part 1.2)" >&2; exit 1; }
	$(DOCKER_GO) go test -race -count=1 ./...
	@if [ -d frontend ]; then $(DOCKER_NODE) sh -ec 'npm ci --no-audit --no-fund && npm test -- --run'; fi

integration-test: ## Migrations up/down and *_integration_test.go against disposable PostgreSQL
	@test -f deploy/docker-compose.test.yml || { echo "deploy/docker-compose.test.yml is not created yet (stage 1, part 1.2)" >&2; exit 1; }
	@set -eu; \
	cleanup() { $(COMPOSE) -p amocrm-pro-admin-test -f deploy/docker-compose.test.yml down --volumes --remove-orphans >/dev/null 2>&1 || true; }; \
	trap cleanup EXIT INT TERM; cleanup; \
	$(COMPOSE) -p amocrm-pro-admin-test -f deploy/docker-compose.test.yml up --detach --wait postgres; \
	$(COMPOSE) -p amocrm-pro-admin-test -f deploy/docker-compose.test.yml run --rm migrate up; \
	$(COMPOSE) -p amocrm-pro-admin-test -f deploy/docker-compose.test.yml run --rm integration-test

e2e: ## Playwright scenarios against the built stack with the fixture adapter
	@test -d frontend/e2e || { echo "frontend/e2e is not created yet (stage 1, part 1.4)" >&2; exit 1; }
	$(DOCKER_NODE) sh -ec 'npm ci --no-audit --no-fund && npx playwright test'

check: docs-check lint test integration-test ## Everything required before merging

# ---------------------------------------------------------------------------
# Fixtures for the Core pilot stack (development only, explicitly labelled)
# ---------------------------------------------------------------------------

fixtures-core-dry-run: ## Validate deploy/fixtures/core-installations.sql inside a rolled-back transaction
	@$(DOCKER) exec -i $(CORE_PILOT_DB_CONTAINER) psql -v ON_ERROR_STOP=1 -U $(CORE_PILOT_DB_USER) -d $(CORE_PILOT_DB_NAME) \
		-c 'BEGIN;' -f deploy/fixtures/core-installations.sql -c 'ROLLBACK;' >/dev/null && echo "fixtures: dry run ok"

fixtures-core: ## Apply labelled fixture installations to the Core pilot stack (requires FIXTURES_CONFIRM=core-pilot)
	@test "$(FIXTURES_CONFIRM)" = "core-pilot" || { echo "Refusing: set FIXTURES_CONFIRM=core-pilot (development pilot stack only)" >&2; exit 1; }
	$(DOCKER) exec -i $(CORE_PILOT_DB_CONTAINER) psql -v ON_ERROR_STOP=1 -U $(CORE_PILOT_DB_USER) -d $(CORE_PILOT_DB_NAME) \
		--single-transaction -f deploy/fixtures/core-installations.sql
