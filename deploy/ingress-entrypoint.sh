#!/bin/sh
set -eu
parse_origin() {
    origin=$1
    printf '%s\n' "$origin" | grep -Eq '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$' || {
        echo 'ingress requires exact HTTPS DNS origins without path' >&2
        exit 1
    }
    authority=${origin#https://}
    host=${authority%%:*}
    port=${authority#"$host"}
    if [ -n "$port" ]; then
        number=${port#:}
        [ "$number" -ge 1 ] && [ "$number" -le 65535 ] || exit 1
    fi
    escaped=$(printf '%s' "$host" | sed 's/\./\\./g')
    if [ -z "$port" ] || [ "$port" = ':443' ]; then
        pattern="$escaped(:443)?"
    else
        pattern="$escaped$port"
    fi
}
parse_origin "${ADMIN_PUBLIC_ORIGIN:?set ADMIN_PUBLIC_ORIGIN}"
CORE_HOST=$host
CORE_MATCH="$escaped\\|$pattern"
parse_origin "${MANAGERS_PUBLIC_ORIGIN:?set MANAGERS_PUBLIC_ORIGIN}"
MANAGERS_HOST=$host
MANAGERS_MATCH="$escaped\\|$pattern"
[ "$(printf '%s' "$CORE_HOST" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$MANAGERS_HOST" | tr '[:upper:]' '[:lower:]')" ] || {
    echo 'ingress origins must use different hostnames' >&2
    exit 1
}
export CORE_HOST CORE_MATCH MANAGERS_HOST MANAGERS_MATCH
envsubst '${CORE_HOST} ${CORE_MATCH} ${MANAGERS_HOST} ${MANAGERS_MATCH}' \
    < /etc/admin-ingress.conf.template > /etc/nginx/conf.d/default.conf
exec "$@"
