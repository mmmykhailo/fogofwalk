#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
osm_path=""
source_url=""
source_checksum=""
output=""
report=""
snapshot="unknown"
extra_args=()

for argument in "$@"; do
  case "$argument" in
    --osm-path=*) osm_path="${argument#*=}" ;;
    --osm-source-url=*) source_url="${argument#*=}" ;;
    --osm-source-checksum=*) source_checksum="${argument#*=}" ;;
    --output=*) output="${argument#*=}" ;;
    --report=*) report="${argument#*=}" ;;
    --osm-snapshot=*) snapshot="${argument#*=}" ;;
    *) extra_args+=("$argument") ;;
  esac
done

for required in osm_path source_url source_checksum output report; do
  if [[ -z "${!required}" ]]; then
    echo "missing --${required//_/-}=..." >&2
    exit 2
  fi
done

"$root_dir/trail-data/gradlew" -p "$root_dir/trail-data" test
"$root_dir/trail-data/gradlew" -p "$root_dir/trail-data" run \
  --args="--osm-path=$osm_path --osm-source-url=$source_url --osm-source-checksum=$source_checksum --output=$output --report=$report --schema-version=1 --minzoom=12 --maxzoom=12 --osm-snapshot=$snapshot ${extra_args[*]}"
bun "$root_dir/trail-data/scripts/verify-archive.mjs" \
  "--archive=$output" "--report=$report"
