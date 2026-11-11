#!/usr/bin/env bash
# Host firewall for a reader-origin box (#8384). Idempotent; safe to re-run.
#
# - ssh (22) from ADMIN_IPS only (default: main, 46.224.122.120).
# - https (443) from Cloudflare's published ranges only, fetched live. Nothing else.
#   The Hetzner cloud firewall (sl-web-fw) sits in front of this and, until Derek opens
#   it, allows 22 from main and nothing more, so this rule is the second lock, not the first.
# - Next (3101-3104) and Caddy's admin API (2019) listen on loopback and are never opened.
#
# Re-run monthly or when Cloudflare announces a range change.
set -euo pipefail
ADMIN_IPS="${ADMIN_IPS:-46.224.122.120}"

v4="$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4)"
v6="$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6)"
# Refuse a short or garbled list: an empty list would leave 443 closed (safe), a wrong one open.
n4=$(grep -cE '^[0-9.]+/[0-9]+$' <<<"$v4" || true); n6=$(grep -cE '^[0-9a-f:]+/[0-9]+$' <<<"$v6" || true)
[ "$n4" -ge 10 ] && [ "$n6" -ge 5 ] || { echo "Cloudflare range list looks wrong ($n4 v4, $n6 v6); not touching the firewall" >&2; exit 1; }

ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
for ip in $ADMIN_IPS; do ufw allow from "$ip" to any port 22 proto tcp comment 'ssh admin'; done
while read -r c; do [ -n "$c" ] && ufw allow from "$c" to any port 443 proto tcp comment 'cloudflare'; done <<<"$v4
$v6"
ufw --force enable
ufw status numbered | head -5
echo "firewall: 22 from [$ADMIN_IPS], 443 from $n4 v4 + $n6 v6 Cloudflare ranges"
