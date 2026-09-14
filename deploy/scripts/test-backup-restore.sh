#!/bin/sh
# Safety regression tests with command doubles only. No Docker daemon or DB.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work=$(mktemp -d)
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$work/bin"
: > "$work/compose.yml"
printf 'fixture dump\n' > "$work/fixture.dump"
export CALL_LOG="$work/calls"
export COMPOSE_FILE="$work/compose.yml"
export BACKUP_FILE="$work/fixture.dump"
export BACKUP_DIR="$work/backups"
export POSTGRES_SERVICE=admin-postgres
export EMPLOYEE_EMAIL=fixture@example.invalid
export MOCK_CREATE_FAIL=0 MOCK_DUMP_FAIL=0
export COMPOSE="$work/bin/mock-compose"
export PATH="$work/bin:$PATH"
cat > "$COMPOSE" <<'MOCK'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$CALL_LOG"
case "$*" in
    *' ps -q '*) echo fixture-container ;;
    *POSTGRES_DB*) printf admin ;;
    *POSTGRES_USER*) printf admin ;;
    *POSTGRES_PASSWORD*) printf fixture-password ;;
    *'CREATE DATABASE'*) exit "$MOCK_CREATE_FAIL" ;;
    *'DROP DATABASE'*) exit 0 ;;
    *' pg_restore '*) cat >/dev/null; exit 1 ;;
    *' pg_dump '*) [ "$MOCK_DUMP_FAIL" = 0 ] || exit 1; echo fixture-archive ;;
    *) echo 'unexpected command in safety test' >&2; exit 99 ;;
esac
MOCK
cat > "$work/bin/docker" <<'MOCK'
#!/bin/sh
[ "$1" = inspect ] || exit 99
printf 'true\n'
MOCK
cat > "$work/bin/date" <<'MOCK'
#!/bin/sh
printf '20000101-000000\n'
MOCK
chmod +x "$work/bin/"*
fail() { echo "FAIL: $*" >&2; exit 1; }
checks=0
passed() { checks=$((checks + 1)); echo "PASS: $*"; }
restore_fails() {
    : > "$CALL_LOG"
    if RESTORE_CONFIRM="$1" SCRATCH_DB="$2" sh "$script_dir/restore-check.sh" > "$work/output" 2>&1; then
        fail "restore unexpectedly succeeded"
    fi
}
no_database_write() {
    if grep -Eq 'CREATE DATABASE|DROP DATABASE|pg_restore' "$CALL_LOG"; then
        fail "unsafe target reached database mutation"
    fi
}
restore_fails '' admin_restore_check
no_database_write
passed 'confirmation required'
long_name=$(printf '%064d' 0)
for name in 'bad-name' "$long_name" postgres template0 template1 admin; do
    restore_fails restore-check "$name"
    no_database_write
    passed "unsafe/live target rejected: $name"
done
MOCK_CREATE_FAIL=1
restore_fails restore-check existing_other_database
grep -q 'CREATE DATABASE' "$CALL_LOG" || fail 'CREATE was not attempted'
if grep -Eq 'DROP DATABASE|pg_restore' "$CALL_LOG"; then
    fail 'failed CREATE must never drop or restore an existing database'
fi
passed 'existing database is not dropped'
MOCK_CREATE_FAIL=0
restore_fails restore-check admin_restore_check
[ "$(grep -c 'CREATE DATABASE' "$CALL_LOG")" -eq 1 ] || fail 'expected one CREATE'
[ "$(grep -c 'DROP DATABASE' "$CALL_LOG")" -eq 1 ] || fail 'only owned DB cleanup may DROP'
grep -q 'pg_restore' "$CALL_LOG" || fail 'restore was not attempted'
passed 'failed restore cleans up only the database created by this run'
# A deliberately permissive caller umask must not expose archive contents.
for iteration in 1 2; do
    (umask 022; sh "$script_dir/backup.sh") > "$work/output" 2>&1 || fail 'backup failed'
done
[ "$(find "$BACKUP_DIR" -type f -name '*.dump' | wc -l | tr -d ' ')" -eq 2 ] || fail 'same-second backups overwrote each other'
for file in "$BACKUP_DIR/"*.dump; do
    [ -s "$file" ] || fail 'empty dump published'
    [ "$(LC_ALL=C ls -l "$file" | cut -c1-10)" = '-rw-------' ] || fail 'dump permissions are not 0600'
done
passed 'same-second backups are distinct and private'
MOCK_DUMP_FAIL=1
if sh "$script_dir/backup.sh" > "$work/output" 2>&1; then
    fail 'failed pg_dump reported success'
fi
[ "$(find "$BACKUP_DIR" -type f | wc -l | tr -d ' ')" -eq 2 ] || fail 'failed backup left temporary/published file'
passed 'failed dump leaves no partial archive'
echo "Safety checks passed: $checks (command doubles; not a PostgreSQL restore)"
