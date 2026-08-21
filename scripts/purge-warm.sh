#!/usr/bin/env bash
#
# Purge the Cloudflare CDN and re-warm the top pages.
#
# Normally invoked by scripts/deploy-prod.sh as its last two steps. Standalone,
# it is the RECOVERY tool for the case where a deploy shipped but the purge did
# not run — a CLI crash mid-poll, or the origin-health gate below refusing to
# purge while the database was unreachable. Run it once the origin recovers.
#
#   npm run deploy:purge-warm
#
# Requires CLOUDFLARE_API_TOKEN (Cache Purge scope — CF_API_TOKEN is WAF-scoped
# only and fails auth here), CLOUDFLARE_ZONE_ID and CRON_SECRET in
# .env.production.local.
#
# FORCE_PURGE=1 skips the origin-health gate.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.production.local ]; then
  echo "✗ .env.production.local not found — cannot read CLOUDFLARE_API_TOKEN/ZONE_ID/CRON_SECRET." >&2
  exit 1
fi
set -a; source .env.production.local; set +a

for var in CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID CRON_SECRET; do
  if [ -z "${!var:-}" ]; then
    echo "✗ $var is not set in .env.production.local." >&2
    exit 1
  fi
done

# ORIGIN HEALTH GATE — a purge is only safe if the origin can refill the cache.
#
# `purge_everything` throws away every cached page and bets the origin can
# re-render them. On 2026-08-18 Atlas was unreachable from Vercel (dynamic API
# routes 500ing after a 15s connection timeout) while CDN-cached pages still
# served fine at 200 — so the cache was the only thing keeping the site usable,
# and deploy-prod.sh purged it twice on failed builds.
#
# Probe something DATA-BACKED and uncacheable, never `/`: a cached homepage
# answers 200 with the database on fire, which is exactly how the old check in
# deploy-prod.sh fooled itself.
if [ "${FORCE_PURGE:-}" != "1" ]; then
  echo "▸ Checking the origin can refill the cache…"
  HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 40 \
    -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' \
    -A 'Mozilla/5.0 (deploy purge origin health check)' \
    "https://sourcelibrary.org/api/books/library?limit=1&_purgecheck=$(date +%s)" || echo 000)
  if [ "$HEALTH_CODE" = "200" ]; then
    echo "  ✓ origin healthy (data route → HTTP $HEALTH_CODE)."
  else
    echo "" >&2
    echo "✗ Origin data route returned HTTP $HEALTH_CODE — REFUSING to purge." >&2
    echo "  Cached pages may currently be the only thing serving readers; purging" >&2
    echo "  now would evict them with nothing able to re-render them." >&2
    echo "  Usual cause: the database is unreachable from Vercel (check the Atlas" >&2
    echo "  IP access list and cluster state), not a problem with the deploy." >&2
    echo "  Re-run this once the origin recovers, or FORCE_PURGE=1 to override." >&2
    exit 1
  fi
fi

echo "▸ Purging Cloudflare cache (purge_everything)…"
PURGE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}')
if echo "$PURGE" | grep -q '"success":true'; then
  echo "  ✓ Cloudflare cache purged."
else
  echo "  ✗ Cloudflare purge failed: $PURGE" >&2
  echo "    (Pages may serve stale HTML/dead CSS until this is re-run.)" >&2
  exit 1
fi

echo "▸ Warming caches (/api/deploy-warm)…"
WARM_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "https://sourcelibrary.org/api/deploy-warm" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  --max-time 300 || true)
echo "  deploy-warm → HTTP $WARM_CODE"
if [ "$WARM_CODE" != "200" ]; then
  # Non-fatal: the purge is the part that must not be skipped. A failed warm
  # only means the first visitor to each page pays the render cost.
  echo "  ⚠ warm did not return 200 — pages will re-render on first visit." >&2
fi

echo "✓ Purge + warm complete."
