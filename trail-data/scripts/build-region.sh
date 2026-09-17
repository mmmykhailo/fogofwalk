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
scratch_dir="$(dirname "$output")"
mkdir -p "$scratch_dir"
time_file="$(mktemp)"
cleanup_metrics() { rm -f "$time_file"; }
trap cleanup_metrics EXIT

scratch_high_water=0
sample_scratch_usage() {
  local usage
  usage="$(df -Pk "$scratch_dir" | awk 'NR == 2 { printf "%.0f\n", $3 * 1024; exit }')"
  if [[ "$usage" =~ ^[0-9]+$ && "$usage" -gt "$scratch_high_water" ]]; then
    scratch_high_water="$usage"
  fi
}

sample_scratch_usage
build_pid=""
if [[ "$(uname -s)" == "Linux" && -x /usr/bin/time ]]; then
  /usr/bin/time -v -o "$time_file" \
    "$root_dir/trail-data/gradlew" -p "$root_dir/trail-data" run \
    --args="--osm-path=$osm_path --osm-source-url=$source_url --osm-source-checksum=$source_checksum --output=$output --report=$report --schema-version=1 --minzoom=12 --maxzoom=12 --osm-snapshot=$snapshot ${extra_args[*]}" &
  build_pid="$!"
else
  "$root_dir/trail-data/gradlew" -p "$root_dir/trail-data" run \
    --args="--osm-path=$osm_path --osm-source-url=$source_url --osm-source-checksum=$source_checksum --output=$output --report=$report --schema-version=1 --minzoom=12 --maxzoom=12 --osm-snapshot=$snapshot ${extra_args[*]}" &
  build_pid="$!"
fi
while kill -0 "$build_pid" 2>/dev/null; do
  sample_scratch_usage
  sleep 1
done
wait "$build_pid"
sample_scratch_usage

peak_memory_bytes=""
if [[ -s "$time_file" ]]; then
  peak_memory_kb="$(awk -F: '/Maximum resident set size/ { gsub(/[[:space:]]/, "", $2); print $2; exit }' "$time_file")"
  if [[ "$peak_memory_kb" =~ ^[0-9]+$ ]]; then
    peak_memory_bytes="$((peak_memory_kb * 1024))"
  fi
fi
bun "$root_dir/trail-data/scripts/verify-archive.mjs" \
  "--archive=$output" "--report=$report"
bun "$root_dir/trail-data/scripts/write-publication-manifest.mjs" \
  "--archive=$output" \
  "--report=$report" \
  "--manifest=$report.manifest.json" \
  "--license=$report.DATA-LICENSE.txt" \
  ${peak_memory_bytes:+"--peak-resident-memory-bytes=$peak_memory_bytes"} \
  "--scratch-disk-high-water-mark-bytes=$scratch_high_water"
