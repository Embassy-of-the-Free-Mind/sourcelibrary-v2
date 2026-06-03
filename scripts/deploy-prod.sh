#!/usr/bin/env bash
#
# Production deploy for sourcelibrary.org — the ONLY safe way to ship frontend.
#
# Why this exists: a bare `vercel --prod` ships new asset hashes and purges the
# previous deploy's CSS/JS chunks, but it does NOT clear the CDN-cached HTML.
# next.config.ts caches rendered HTML at the edge for 24h (`CDN-Cache-Control:
# max-age=86400`) on /collections/*, /book/*, /author/*, /gallery/*, /browse/*,
# etc. So any page cached just before a deploy keeps pointing at a now-404'd
# /_next/static/chunks/*.css and renders FULLY UNSTYLED (looks like "broken
# images / junk content") for up to 24h. The automated post-deploy-warm.yml
# only fires on push-to-main, which does NOT deploy prod — so manual deploys
# skip the purge entirely. This wrapper closes that gap: deploy, then purge +
# warm, every time.
#
# Usage:  npm run deploy:prod   (or)   ./scripts/deploy-prod.sh
#
# Requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, CRON_SECRET in
# .env.production.local (gitignored, Vercel-managed). NOTE: the purge needs
# CLOUDFLARE_API_TOKEN (Cache Purge scope) — CF_API_TOKEN is WAF-scoped only
# and returns an auth error on purge.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 1. Guard: production deploys only from the main directory on `main`.
#    `vercel --prod` deploys whatever is on disk, ignoring Vercel's branch
#    setting — shipping a feature branch to prod is a real foot-gun.
BRANCH="$(git branch --show-current)"
if [ "$BRANCH" != "main" ]; then
  echo "✗ Refusing to deploy prod from branch '$BRANCH'. Switch the main directory to 'main' first." >&2
  exit 1
fi

# 2. Load production env (CF token, zone, cron secret). No secrets are hardcoded.
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

# 3. Typecheck before burning a deploy cycle (the #1 source of wasted deploys).
echo "▸ Typechecking (npx tsc --noEmit)…"
npx tsc --noEmit

# 4. Deploy to production.
echo "▸ Deploying to production (vercel --prod)…"
vercel --prod

# 5. Purge the CDN so cached HTML can't outlive the assets it references.
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

# 6. Re-warm top pages so the next visitor gets a fresh, styled page from cache.
echo "▸ Warming caches (/api/deploy-warm)…"
WARM_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "https://sourcelibrary.org/api/deploy-warm" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  --max-time 300 || true)
echo "  deploy-warm → HTTP $WARM_CODE"

echo "✓ Production deploy complete (deployed → purged → warmed)."
