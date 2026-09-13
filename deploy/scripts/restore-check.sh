#!/bin/sh
# Restore an admin DB dump into a scratch database and verify it.
#
# The live database is only read (row counts and the sample employee); the
# restored data lands in a new scratch database in the same instance and is
# dropped on exit, even on failure.
#
# Environment:
#   BACKUP_FILE       required path to a .dump archive (backup.sh output)
#   RESTORE_CONFIRM   must be exactly "restore-check"
#   COMPOSE_FILE      compose file (default: deploy/docker-compose.yml)
#   POSTGRES_SERVICE  compose service with PostgreSQL (default: admin-postgres)
#   SCRATCH_DB        scratch database name (default: admin_restore_check)
#   EMPLOYEE_EMAIL    known employee to select (default: first active employee)
#   COMPOSE           compose command (default: autodetected)
#
# Credentials come from the postgres container environment and are never
# printed.
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-admin-postgres}"
SCRATCH_DB="${SCRATCH_DB:-admin_restore_check}"
RESTORE_CONFIRM="${RESTORE_CONFIRM:-}"
BACKUP_FILE="${BACKUP_FILE:-}"
EMPLOYEE_EMAIL="${EMPLOYEE_EMAIL:-}"

fail() {
    echo "restore-check: $*" >&2
    exit 1
}

[ "$RESTORE_CONFIRM" = "restore-check" ] || fail \
    "refusing: set RESTORE_CONFIRM=restore-check (the live database is never touched)"
[ -n "$BACKUP_FILE" ] || fail "BACKUP_FILE is required (path to a .dump archive)"
case "$BACKUP_FILE" in
    *.dump) ;;
    *) fail "BACKUP_FILE must point to a .dump archive: $BACKUP_FILE" ;;
esac
[ -f "$BACKUP_FILE" ] || fail "BACKUP_FILE not found: $BACKUP_FILE"
[ -r "$BACKUP_FILE" ] || fail "BACKUP_FILE is not readable: $BACKUP_FILE"
[ -f "$COMPOSE_FILE" ] || fail "compose file not found: $COMPOSE_FILE"
case "$SCRATCH_DB" in
    '' | *[!A-Za-z0-9_]*) fail "SCRATCH_DB must contain only letters, digits and underscores" ;;
esac

if [ -z "${COMPOSE:-}" ]; then
    if docker compose version >/dev/null 2>&1; then
        COMPOSE="docker compose"
    elif command -v docker-compose >/dev/null 2>&1; then
        COMPOSE="docker-compose"
    else
        fail "neither 'docker compose' nor 'docker-compose' is available"
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

service_running || fail "postgres service '$POSTGRES_SERVICE' is not running in $COMPOSE_FILE"

db_name=$(compose_exec sh -c 'printf "%s" "${POSTGRES_DB:-postgres}"')
db_user=$(compose_exec sh -c 'printf "%s" "${POSTGRES_USER:-postgres}"')
db_password=$(compose_exec sh -c 'printf "%s" "${POSTGRES_PASSWORD:-}"')

[ "$db_name" != "$SCRATCH_DB" ] || fail \
    "refusing: scratch database equals the live database '$db_name'"

psql_live() {
    compose_exec psql --no-psqlrc --tuples-only --no-align \
        --set=ON_ERROR_STOP=1 --username="$db_user" --dbname="$db_name" "$@"
}

psql_scratch() {
    compose_exec psql --no-psqlrc --tuples-only --no-align \
        --set=ON_ERROR_STOP=1 --username="$db_user" --dbname="$SCRATCH_DB" "$@"
}

scratch_created=0
cleanup() {
    if [ "$scratch_created" -eq 1 ]; then
        compose_exec psql --quiet --set=ON_ERROR_STOP=1 --username="$db_user" \
            --dbname=postgres \
            -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\" WITH (FORCE);" \
            >/dev/null 2>&1 || true
        echo "restore-check: dropped scratch database '$SCRATCH_DB'"
    fi
}
trap cleanup EXIT HUP INT TERM

echo "restore-check: creating scratch database '$SCRATCH_DB'"
compose_exec psql --quiet --set=ON_ERROR_STOP=1 --username="$db_user" \
    --dbname=postgres \
    -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\" WITH (FORCE);" \
    -c "CREATE DATABASE \"$SCRATCH_DB\";" >/dev/null
scratch_created=1

echo "restore-check: restoring $BACKUP_FILE into '$SCRATCH_DB'"
if ! compose_exec pg_restore --exit-on-error --no-owner --no-privileges \
    --username="$db_user" --dbname="$SCRATCH_DB" < "$BACKUP_FILE"; then
    fail "pg_restore failed for $BACKUP_FILE"
fi

if ! before_versions=$(psql_scratch -c \
        "SELECT version FROM schema_migrations ORDER BY version" 2>/dev/null); then
    fail "restored database has no readable schema_migrations table"
fi

quote_dsn_value() {
    printf "'%s'" "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g")"
}

sql_quote() {
    printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

database_url="host=$(quote_dsn_value "$POSTGRES_SERVICE") port=5432"
database_url="$database_url dbname=$(quote_dsn_value "$SCRATCH_DB")"
database_url="$database_url sslmode=disable user=$(quote_dsn_value "$db_user")"
if [ -n "$db_password" ]; then
    database_url="$database_url password=$(quote_dsn_value "$db_password")"
fi

echo "restore-check: running migration runner against '$SCRATCH_DB'"
if ! DATABASE_URL="$database_url" \
        $COMPOSE -f "$COMPOSE_FILE" run --rm --no-deps \
        -e DATABASE_URL migrate up; then
    fail "migration runner failed against the restored database"
fi

after_versions=$(psql_scratch -c \
    "SELECT version FROM schema_migrations ORDER BY version")
[ "$before_versions" = "$after_versions" ] || fail \
    "migration runner changed schema_migrations; the dump is not at the current schema"

for table in schema_migrations employees sessions admin_audit_log operations saved_views; do
    exists=$(psql_scratch -c "SELECT to_regclass('public.$table') IS NOT NULL")
    [ "$exists" = "t" ] || fail \
        "required table '$table' is missing from the restored database"
done

for table in employees admin_audit_log; do
    live_count=$(psql_live -c "SELECT count(*) FROM $table")
    restored_count=$(psql_scratch -c "SELECT count(*) FROM $table")
    [ "$live_count" = "$restored_count" ] || fail \
        "$table row count mismatch: live=$live_count restored=$restored_count"
    echo "restore-check: $table rows: live=$live_count restored=$restored_count"
done

if [ -z "$EMPLOYEE_EMAIL" ]; then
    EMPLOYEE_EMAIL=$(psql_live -c \
        "SELECT email FROM employees WHERE status = 'active' ORDER BY created_at, id LIMIT 1")
fi
[ -n "$EMPLOYEE_EMAIL" ] || fail \
    "no active employee in the live database; pass EMPLOYEE_EMAIL=<email>"

found=$(psql_scratch -c \
    "SELECT count(*) FROM employees WHERE email = $(sql_quote "$EMPLOYEE_EMAIL")")
[ "$found" = "1" ] || fail \
    "employee email found $found time(s) in the restored database, expected 1"

safe_email=$(printf '%s' "$EMPLOYEE_EMAIL" | tr -d '\r\n')
echo "restore-check: employee $safe_email present in the restored database"
echo "restore-check: ok"
