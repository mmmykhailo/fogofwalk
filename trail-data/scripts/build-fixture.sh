#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bun "$root_dir/trail-data/scripts/build-fixture.mjs" "$@"
bun "$root_dir/trail-data/scripts/verify-archive.mjs" \
  "--archive=$root_dir/e2e/fixtures/trails-v1.pmtiles" \
  "--expected=$root_dir/trail-data/fixtures/expected-z12.json"
