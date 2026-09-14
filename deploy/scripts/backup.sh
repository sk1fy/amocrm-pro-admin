#!/bin/sh
# Back up the admin PostgreSQL database as a custom-format pg_dump archive.
#
# Environment:
#   BACKUP_DIR        output directory (default: ./backups from the repo root)
#   COMPOSE_FILE      compose file (default: deploy/docker-compose.yml)
#   POSTGRES_SERVICE  compose service with PostgreSQL (default: admin-postgres)
#   COMPOSE           compose command (default: autodetected)
#
# Credentials come from the postgres container environment and are never
# printed.
set -eu
umask 077

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-admin-postgres}"

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "backup: compose file not found: $COMPOSE_FILE" >&2
    exit 1
fi

if [ -z "${COMPOSE:-}" ]; then
    if docker compose version >/dev/null 2>&1; then
        COMPOSE="docker compose"
    elif command -v docker-compose >/dev/null 2>&1; then
        COMPOSE="docker-compose"
    else
        echo "backup: neither 'docker compose' nor 'docker-compose' is available" >&2
        exit 1
    fi
fi

compose_exec() {
    $COMPOSE -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" "$@"
}

service_running() {
    container_ids=$($COMPOSE -f "$COMPOSE_FILE" ps -q "$POSTGRES_SERVICE" 2>/dev/null || true)
    [ -n "$container_ids" ] || return 1
    docker inspect --format '{{.State.Running}}' $container_ids 2>/dev/null | grep -q true
}

if ! service_running; then
    echo "backup: postgres service '$POSTGRES_SERVICE' is not running in $COMPOSE_FILE" >&2
    exit 1
fi

db_name=$(compose_exec sh -c 'printf "%s" "${POSTGRES_DB:-postgres}"')
db_user=$(compose_exec sh -c 'printf "%s" "${POSTGRES_USER:-postgres}"')

mkdir -p "$BACKUP_DIR"

timestamp=$(date +%Y%m%d-%H%M%S)
# Keep the X template at the end for both BSD and GNU mktemp. Appending the
# archive extension only after allocation preserves uniqueness in one second.
partial=$(mktemp "$BACKUP_DIR/admin-$timestamp-XXXXXX")
output="$partial.dump"

cleanup() {
    rm -f "$partial"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

echo "backup: dumping database '$db_name' from service '$POSTGRES_SERVICE'"
compose_exec pg_dump --format=custom --no-owner --no-privileges \
    --username="$db_user" --dbname="$db_name" > "$partial"

if [ ! -s "$partial" ]; then
    echo "backup: pg_dump produced an empty archive; aborting" >&2
    exit 1
fi

mv "$partial" "$output"

bytes=$(wc -c < "$output" | tr -d ' ')
human=$(du -h "$output" | cut -f1)
echo "backup: wrote $output ($human, $bytes bytes)"
