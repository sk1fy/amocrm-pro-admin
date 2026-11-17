#!/bin/sh
set -eu
cd "$(dirname "$0")"

case "${1:-}" in
  "") output=client.gen.go ;;
  --check)
    output=$(mktemp)
    trap 'rm -f "$output"' EXIT HUP INT TERM
    ;;
  *) exit 2 ;;
esac

go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.2 \
  -config ../../api/platform-v1-codegen.yaml -o "$output" \
  ../../api/platform-v1-openapi.yaml

if [ "${1:-}" = --check ]; then
  diff -u client.gen.go "$output"
fi
