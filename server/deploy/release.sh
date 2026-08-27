#!/usr/bin/env bash
#
# Activates a release that the deploy workflow has already rsync'd to
# /srv/fogofwalk/releases/<sha>. Runs on the VPS as the deploy user:
#
#   bash /srv/fogofwalk/releases/<sha>/server/deploy/release.sh <sha> <health-url>
#
# Install deps → swap the `current` symlink → restart → health-check, and put
# the previous release back if the new one does not come up. It ships inside
# the release itself, so the version of this script that runs is always the one
# that matches the code being deployed.
#
set -euo pipefail

SHA="${1:?usage: release.sh <sha> <health-url>}"
HEALTH_URL="${2:?usage: release.sh <sha> <health-url>}"

ROOT_DIR="/srv/fogofwalk"
RELEASE_DIR="$ROOT_DIR/releases/$SHA"
KEEP_RELEASES=3
HEALTH_ATTEMPTS=30
HEALTH_INTERVAL=1

say() { printf '\n=== %s\n' "$1"; }

if [[ ! -d "$RELEASE_DIR/server" ]]; then
	echo "no release at $RELEASE_DIR" >&2
	exit 1
fi

say "installing dependencies"
# --production skips typescript/@types/bun: Bun executes the TypeScript
# directly, so nothing in the runtime path needs them.
(cd "$RELEASE_DIR/server" && /usr/local/bin/bun install --frozen-lockfile --production)

# Empty on the very first deploy, which is the one case where there is nothing
# to roll back to.
PREVIOUS="$(readlink -f "$ROOT_DIR/current" 2>/dev/null || true)"

activate() {
	local target="$1"
	ln -sfn "$target" "$ROOT_DIR/current.tmp"
	mv -T "$ROOT_DIR/current.tmp" "$ROOT_DIR/current"
	sudo systemctl restart fogofwalk.service
}

healthy() {
	local attempt
	for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
		if curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | grep -q '"ok":true'; then
			echo "healthy after ${attempt}s"
			return 0
		fi
		sleep "$HEALTH_INTERVAL"
	done
	return 1
}

say "activating $SHA"
activate "$RELEASE_DIR"

if ! healthy; then
	say "health check failed"
	# env.ts parses with Zod at import time, so a bad env file kills the
	# process at boot and the reason is in the journal.
	journalctl -u fogofwalk.service -n 40 --no-pager || true

	if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$RELEASE_DIR" && -d "$PREVIOUS" ]]; then
		say "rolling back to $(basename "$PREVIOUS")"
		activate "$PREVIOUS"
		if healthy; then
			echo "rollback succeeded — the previous release is serving"
		else
			echo "rollback did NOT come up either; the API is down" >&2
		fi
	else
		echo "no previous release to roll back to" >&2
	fi
	exit 1
fi

say "pruning old releases"
# Newest first; never touch whatever `current` points at.
current_target="$(readlink -f "$ROOT_DIR/current")"
mapfile -t releases < <(ls -1dt "$ROOT_DIR/releases"/*/ 2>/dev/null || true)
kept=0
for release in "${releases[@]}"; do
	release="${release%/}"
	if [[ "$release" == "$current_target" ]]; then
		continue
	fi
	kept=$((kept + 1))
	if [[ "$kept" -ge "$KEEP_RELEASES" ]]; then
		echo "removing $(basename "$release")"
		rm -rf "$release"
	fi
done

say "deployed $SHA"
