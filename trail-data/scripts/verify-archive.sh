#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec bun "$root_dir/trail-data/scripts/verify-archive.mjs" "$@"
