#!/usr/bin/env bash
#
# One-time VPS provisioning for the Fog of Walk sync server. Run as root on a
# fresh Debian box:
#
#   scp -r server/deploy root@<vps>:/tmp/fow-deploy
#   scp deploy_key.pub root@<vps>:/tmp/fow-deploy/
#   ssh root@<vps> 'DEPLOY_SSH_KEY="$(cat /tmp/fow-deploy/deploy_key.pub)" \
#     bash /tmp/fow-deploy/provision.sh'
#
# Copy the .pub file over rather than interpolating it: inside '...' the
# $(cat) runs on the VPS, and inside "..." the local shell would expand
# $DEPLOY_SSH_KEY before ssh ever saw it.
#
# Idempotent: safe to re-run after editing the unit file or the Caddyfile.
# It does NOT start the service — there is no release on disk until the
# deploy workflow has run once.
#
set -euo pipefail

BUN_VERSION="${BUN_VERSION:-1.3.4}"
API_DOMAIN="${API_DOMAIN:-api.fog-of-walk.mykhailo.net}"
APP_USER="${APP_USER:-fogofwalk}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
ROOT_DIR="/srv/fogofwalk"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
	echo "provision.sh must run as root" >&2
	exit 1
fi

say() { printf '\n=== %s\n' "$1"; }

say "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
	ca-certificates curl unzip rsync sqlite3 ufw gnupg \
	debian-keyring debian-archive-keyring apt-transport-https

say "bun ${BUN_VERSION}"
# Installed system-wide rather than into a user's home so the systemd unit can
# name an absolute path that survives user changes.
if [[ "$(/usr/local/bin/bun --version 2>/dev/null || true)" != "$BUN_VERSION" ]]; then
	BUN_INSTALL=/usr/local bash <(curl -fsSL https://bun.sh/install) "bun-v${BUN_VERSION}"
fi
/usr/local/bin/bun --version

say "caddy"
# Apache-2.0. Automatic Let's Encrypt certificates and renewal.
if ! command -v caddy >/dev/null 2>&1; then
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
		gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
		>/etc/apt/sources.list.d/caddy-stable.list
	apt-get update
	apt-get install -y caddy
fi

say "users"
# The service account: no shell, no password, owns nothing but its data.
if ! id -u "$APP_USER" >/dev/null 2>&1; then
	useradd --system --home-dir "$ROOT_DIR" --no-create-home \
		--shell /usr/sbin/nologin "$APP_USER"
fi
# The CI account: SSH only, may restart the unit and nothing else.
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
	useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
# So a failed deploy can print the service's own logs back to the workflow.
usermod -aG systemd-journal "$DEPLOY_USER"

say "authorized_keys"
deploy_home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$deploy_home/.ssh"
if [[ -n "${DEPLOY_SSH_KEY:-}" ]]; then
	touch "$deploy_home/.ssh/authorized_keys"
	grep -qxF "$DEPLOY_SSH_KEY" "$deploy_home/.ssh/authorized_keys" ||
		echo "$DEPLOY_SSH_KEY" >>"$deploy_home/.ssh/authorized_keys"
	chown "$DEPLOY_USER:$DEPLOY_USER" "$deploy_home/.ssh/authorized_keys"
	chmod 600 "$deploy_home/.ssh/authorized_keys"
elif [[ ! -s "$deploy_home/.ssh/authorized_keys" ]]; then
	# Skipping this silently is how you get "Permission denied (publickey)"
	# from the workflow half an hour later. Note that quoting the ssh command
	# with '...' evaluates $(cat ...) on THIS machine, where the .pub file
	# does not exist — which is the usual way DEPLOY_SSH_KEY ends up empty.
	echo
	echo "WARNING: DEPLOY_SSH_KEY was not set and ${DEPLOY_USER} has no" >&2
	echo "authorized_keys. The deploy workflow cannot log in. Re-run with:" >&2
	echo "  DEPLOY_SSH_KEY=\"\$(cat /tmp/fow-deploy/deploy_key.pub)\" bash provision.sh" >&2
fi
if [[ -s "$deploy_home/.ssh/authorized_keys" ]]; then
	echo "keys authorised for ${DEPLOY_USER}:"
	ssh-keygen -l -f "$deploy_home/.ssh/authorized_keys" || true
fi

say "layout"
# /srv/fogofwalk is deploy-owned and world-traversable: the deploy user writes
# releases and server.env into it, the service user only reads through it.
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ROOT_DIR"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ROOT_DIR/releases"
# DATA_DIR — the SQLite file and the geometry blobs. Lives outside the release
# directories so it survives every deploy and every rollback.
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$ROOT_DIR/data"
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$ROOT_DIR/cache"

say "systemd unit"
install -m 644 "$HERE/fogofwalk.service" /etc/systemd/system/fogofwalk.service
systemctl daemon-reload
systemctl enable fogofwalk.service

say "sudoers"
# Deliberately narrow: restart and interrogate one unit, nothing else.
cat >/etc/sudoers.d/fogofwalk-deploy <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart fogofwalk.service, /usr/bin/systemctl is-active fogofwalk.service, /usr/bin/systemctl show fogofwalk.service *
EOF
chmod 440 /etc/sudoers.d/fogofwalk-deploy
visudo -c -f /etc/sudoers.d/fogofwalk-deploy

say "caddy config for ${API_DOMAIN}"
sed "s|api\.fog-of-walk\.mykhailo\.net|${API_DOMAIN}|" "$HERE/Caddyfile" \
	>/etc/caddy/Caddyfile
install -d -m 755 -o caddy -g caddy /var/log/caddy
systemctl reload-or-restart caddy

if [[ "${SKIP_UFW:-0}" != "1" ]]; then
	say "firewall"
	# OpenSSH first — enabling ufw without it locks this session out.
	ufw allow OpenSSH
	ufw allow 80/tcp
	ufw allow 443/tcp
	ufw --force enable
	ufw status verbose
fi

cat <<EOF

Provisioned. Port 8787 is never opened: the server binds 127.0.0.1 and Caddy
is the only way in.

Next:
  1. Point ${API_DOMAIN} at this host (A record) if you have not already.
  2. Set the repo secrets and variables listed in server/README.md.
  3. Run the "Deploy server" workflow.

Until the first deploy, /srv/fogofwalk/current does not exist and
'systemctl status fogofwalk' will show the unit as failed. That is expected.
EOF
