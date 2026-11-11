#!/usr/bin/env bash
# One-time (idempotent) setup of a reader-origin box for the staged traffic test (#8384).
#
# PRIOR ART: infrastructure/caddy/Caddyfile.l7a and infrastructure/systemd/*.service run
# search services on job boxes; this box runs the Next app itself and nothing else, so it
# gets its own folder. The process layout (4 × `next start -H localhost` behind Caddy) is
# the one #8374 measured.
#
# Run as root on the box:  bash setup.sh
# Then:                    bash deploy.sh            (builds the commit `release` points at)
#
# What it installs: Node 22, Caddy, a `slweb` user, /srv/sl-web, the systemd units, the
# Caddyfile, and the host firewall (firewall.sh). It does NOT write /etc/sl-web/env (the
# secrets): make-env.mjs does that from a machine that holds them.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git ufw debian-keyring debian-archive-keyring apt-transport-https jq

# --- Node 22 (NodeSource) ---------------------------------------------------
if ! node -v 2>/dev/null | grep -q '^v22\.'; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs
fi

# --- Caddy (official apt repo) ---------------------------------------------
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

# --- user and folders -------------------------------------------------------
id slweb >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/sl-web --shell /usr/sbin/nologin slweb
install -d -o slweb -g slweb -m 0755 /srv/sl-web /srv/sl-web/releases /srv/sl-web/static /srv/sl-web/log /srv/sl-web/npm-cache
install -d -o root -g slweb -m 0750 /etc/sl-web
install -m 0644 "$HERE/guard.cjs" /etc/sl-web/guard.cjs
install -m 0755 "$HERE/deploy.sh" /usr/local/bin/sl-web-deploy
install -m 0644 "$HERE/guard-control.mjs" /etc/sl-web/guard-control.mjs
install -m 0755 "$HERE/sl-web-guard-control" /usr/local/bin/sl-web-guard-control

# --- systemd ----------------------------------------------------------------
install -m 0644 "$HERE/sl-web@.service" /etc/systemd/system/sl-web@.service
install -m 0644 "$HERE/sl-web.slice" /etc/systemd/system/sl-web.slice
install -m 0644 "$HERE/sl-web-deploy.service" /etc/systemd/system/sl-web-deploy.service
install -m 0644 "$HERE/sl-web-deploy.timer" /etc/systemd/system/sl-web-deploy.timer
systemctl daemon-reload

# --- Caddy ------------------------------------------------------------------
install -m 0644 "$HERE/Caddyfile" /etc/caddy/Caddyfile
# Caddy reads SL_BOX_SECRET and the TLS mode from here (see Caddyfile).
[ -f /etc/sl-web/caddy.env ] || install -m 0640 -o root -g caddy /dev/null /etc/sl-web/caddy.env
install -d /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/sl-web.conf <<'EOF'
[Service]
EnvironmentFile=/etc/sl-web/caddy.env
EOF
systemctl daemon-reload

# --- firewall ---------------------------------------------------------------
bash "$HERE/firewall.sh"

echo "setup done. Next: write /etc/sl-web/env and /etc/sl-web/caddy.env (make-env.mjs), then sl-web-deploy."
